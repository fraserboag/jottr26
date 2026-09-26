import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import {
  activeDatabase,
  openDatabase,
  readMeta,
  writeMeta,
  type JottrDB,
} from '@/lib/db/dexie'
import {
  META_DOCS_CURSOR,
  META_LAST_SYNCED,
  META_PAGES_CURSOR,
  PAGE_FIELDS,
  type DocStateRow,
  type PageField,
  type PageRow,
} from '@/lib/db/schema'
import { forgetPages, touch } from '@/lib/db/pages'
import { closePeerChannel, openPeerChannel } from '@/lib/db/peers'
import {
  applyRemoteUpdate,
  onLocalEdit,
  onSaveFailure,
  openDoc,
  patchDocState,
  readPlainText,
  readTitle,
  refreshFromDisk,
  loadedDoc,
  sameBytes,
  saveFailure,
  unsavedPages,
} from '@/lib/db/ydoc'
import { base64ToBytes, bytesToBase64 } from '@/lib/util/base64'
import { initialStatus, type SyncStatus } from './types'

/** Re-read a window either side of the last cursor. The server stamps
 *  updated_at itself, but a transaction can take its timestamp before our pull
 *  runs and commit after it — the overlap is what stops that row going missing.
 *  Re-applying rows is free: Yjs merges are idempotent and metadata is LWW. */
const OVERLAP_MS = 30_000
const PAGE_SIZE = 500
const BLOB_CHUNK = 20
/** Rows per upsert or purge request. */
const PUSH_BATCH = 100
const POLL_INTERVAL_MS = 45_000
/** How often to check with the server while realtime is not connected, since
 *  nothing else will say when another device has written. */
const OFFLINE_REALTIME_POLL_MS = 10_000
/** Documents pushed at once. Catching up after a day offline should not mean
 *  one round trip per note, one after another. */
const PUSH_CONCURRENCY = 4
const EDIT_DEBOUNCE_MS = 1_200
/** Trashing, moving, creating or deleting a page. Short enough to feel
 *  immediate, long enough to gather a whole emptied trash into one push. */
const STRUCTURE_DEBOUNCE_MS = 150
/** Most syncs finish in well under a second. Announcing every one of them would
 *  make a working app look unstable, so the status only changes if a sync is
 *  still running after this long. */
const SAVING_ANNOUNCE_MS = 300
const REALTIME_DEBOUNCE_MS = 400
/** How often typing recounts the pending pages: at most this often, and once
 *  more when it stops. */
const PENDING_RECOUNT_MS = 300
const MAX_CAS_ATTEMPTS = 6
const MAX_BACKOFF_MS = 30_000
/** A request can hang without ever failing — a phone suspends the app mid
 *  fetch and the socket never answers. Without a deadline that one request
 *  would hold every later sync behind it. Progress is kept per page, so a slow
 *  first sync that hits this just carries on from where it stopped. */
const CYCLE_TIMEOUT_MS = 90_000
/** How often the full list of ids is checked against the server. Tombstones
 *  carry deletes on their own; this is the backstop for anything they miss,
 *  like pages deleted before tombstones existed. */
const RECONCILE_INTERVAL_MS = 10 * 60_000

interface ServerPage {
  id: string
  title: string
  parent_id: string | null
  sort_key: string
  is_favorite: boolean
  deleted_at: string | null
  purged_at?: string | null
  created_at: string
  updated_at: string
}

type Listener = (status: SyncStatus) => void

/** What tabs tell each other about sync. Only the leader talks to the server,
 *  so it is the only tab that knows how the last sync went; every other tab
 *  shows what it reports. */
type StatusMessage =
  | { type: 'status'; status: SyncStatus }
  | { type: 'ask' }
  /** Sent by a tab that is not the leader when it has changed something, so
   *  the leader pushes now instead of on its next poll. */
  | { type: 'nudge' }

/** Pages with a change the server has not acknowledged, in the row, the
 *  document, or both. */
export async function countPending(db: JottrDB) {
  // A delete made for good offline is waiting to upload like any edit, so it
  // counts too: sign-out warns before erasing it, and the status is not
  // 'synced' while it is queued.
  const [pages, docs, purges] = await Promise.all([
    db.pages.where('dirty').equals(1).primaryKeys(),
    db.docStates.where('dirty').equals(1).primaryKeys(),
    db.purges.toCollection().primaryKeys(),
  ])
  // An edit that never reached the disk is only in this tab's memory, and is
  // lost for good if the database is erased.
  return new Set([...pages, ...docs, ...purges, ...unsavedPages()] as string[]).size
}

/** A server timestamp as an exact key, down to the microsecond Postgres keeps
 *  and Date.parse drops, so the same stamp read from two places — a push's
 *  reply and a realtime event — compares equal whatever its formatting. Null
 *  for anything that does not parse, which never matches. */
function stampKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? ''
  return `${Math.floor(ms / 1000)}.${fraction.padEnd(6, '0').slice(0, 6)}`
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Whether writing `patch` over `row` would change anything. */
function changes<T extends object>(row: T, patch: Partial<T>) {
  return (Object.keys(patch) as Array<keyof T>).some((key) => row[key] !== patch[key])
}

export class SyncEngine {
  private readonly supabase: SupabaseClient
  private readonly userId: string
  private readonly db: JottrDB

  private status: SyncStatus = { ...initialStatus, phase: 'synced' }
  private listeners = new Set<Listener>()

  private running = false
  private isLeader = false
  private lockAbort: AbortController | null = null
  private lockAttempt = 0
  private leaderAttempt = 0
  private statusChannel: BroadcastChannel | null = null
  private channel: RealtimeChannel | null = null

  private inFlight = false
  private requeue = false
  private failures = 0
  private cycleTimeoutMs = CYCLE_TIMEOUT_MS
  /** 0 until the first check, so every session starts with one. */
  private reconciledAt = 0
  /** The sync in progress, so a manual sync can wait for it to finish. */
  private current: Promise<void> | null = null
  /** Aborts the requests of the sync in progress. */
  private runAbort: AbortController | null = null
  /** Cancels a manual sync that is still waiting its turn. */
  private manualAbort: AbortController | null = null
  /** Manual syncs waiting for this tab to become the leader. */
  private leaderWaiters: Array<() => void> = []

  private pollTimer: ReturnType<typeof setInterval> | null = null
  /** The realtime channel is joined, so another device's write will announce
   *  itself and the poll can stay slow. */
  private realtimeUp = false
  /** When the last sync started, for pacing the poll. */
  private lastRunAt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private announceTimer: ReturnType<typeof setTimeout> | null = null
  private editTimer: ReturnType<typeof setTimeout> | null = null
  /** The pending edit push is on the short fuse. */
  private editUrgent = false
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null
  private recountTimer: ReturnType<typeof setTimeout> | null = null
  private recountAgain = false
  /** The page row stamp each of this device's own writes left on the server.
   *  Realtime hands every write straight back, and a cycle to pull what this
   *  device just pushed is wasted; an event carrying anyone else's stamp still
   *  starts one. */
  private ownStamps = new Set<string>()
  private cleanups: Array<() => void> = []
  /** Lets go of the leader lock this tab holds. */
  private releaseLock: (() => void) | null = null
  /** Documents whose last push failed. They go to the back of the queue, so
   *  one that keeps failing cannot hold every document behind it. */
  private failedDocs = new Set<string>()

  constructor(supabase: SupabaseClient, userId: string) {
    this.supabase = supabase
    this.userId = userId
    this.db = openDatabase(userId)
  }

  // --- lifecycle ----------------------------------------------------------

  async start() {
    if (this.running) return
    this.running = true

    openPeerChannel(this.userId)

    this.openStatusChannel()

    // Not 'syncing': this tab may never be the one that syncs, and nothing but
    // a finished sync would move it on. A slow first sync announces itself.
    const lastSyncedAt = await readMeta<number | null>(this.db, META_LAST_SYNCED, null)
    await this.refreshPending({ lastSyncedAt, phase: navigator.onLine ? 'synced' : 'offline' })
    // Stopped while those reads were out — a StrictMode remount, or a sign-out
    // straight after sign-in. stop() has already run its cleanups, so nothing
    // registered from here on would ever be removed.
    if (!this.running) return

    this.listen(window, 'online', () => {
      if (!this.isLeader) return
      this.emit({ phase: 'syncing', error: null, retryAt: null })
      this.failures = 0
      this.request()
    })
    this.listen(window, 'offline', () => this.emit({ phase: 'offline' }))
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      if (this.isLeader) this.request()
      else void this.electLeader(true)
    })

    // A dropped socket, a sleeping laptop and a throttled background tab all
    // look the same from here, so never rely on events alone.
    this.pollTimer = setInterval(() => this.poll(), OFFLINE_REALTIME_POLL_MS)

    this.cleanups.push(
      onLocalEdit((kind) => {
        this.recountSoon()
        // Typing must not push back a structural push that is about to go; it
        // rides along with it instead.
        if (this.editTimer && this.editUrgent) return
        if (this.editTimer) clearTimeout(this.editTimer)
        this.editUrgent = kind === 'structure'
        this.editTimer = setTimeout(
          () => {
            this.editTimer = null
            this.editUrgent = false
            this.flushEdit()
          },
          this.editUrgent ? STRUCTURE_DEBOUNCE_MS : EDIT_DEBOUNCE_MS,
        )
      }),
    )

    this.cleanups.push(onSaveFailure(() => void this.refreshPending().then(() => this.notify())))

    void this.electLeader(document.visibilityState === 'visible')
  }

  stop() {
    this.running = false
    this.isLeader = false
    this.lockAbort?.abort()
    this.lockAbort = null
    this.releaseLock?.()
    this.releaseLock = null
    this.runAbort?.abort()
    for (const resolve of this.leaderWaiters.splice(0)) resolve()
    this.dropRealtime()
    this.statusChannel?.close()
    this.statusChannel = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.announceTimer) clearTimeout(this.announceTimer)
    if (this.editTimer) clearTimeout(this.editTimer)
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    if (this.recountTimer) clearTimeout(this.recountTimer)
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    closePeerChannel()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.shown())
    return () => this.listeners.delete(listener)
  }

  getStatus() {
    return this.shown()
  }

  /** Ask for a sync now. Safe to call as often as you like. After a failure
   *  it waits out the backoff: an edit, a realtime event or the tab coming
   *  back would otherwise each start a sync bound to fail, every second or so
   *  while typing through an outage. The sync button goes straight through. */
  request() {
    if (this.inBackoff()) return
    void this.run()
  }

  /** A failed sync has its retry scheduled already, backing off. */
  private inBackoff() {
    return this.status.phase === 'error' && (this.status.retryAt ?? 0) > Date.now()
  }

  /** Runs a sync and resolves once it has settled, rather than firing and
   *  forgetting. Used wherever the caller needs to know the round trip is over. */
  async syncOnce() {
    await this.run()
  }

  /** The status menu's sync button. Unlike request(), this resolves only once
   *  a sync that started after the click has finished, and with how it went —
   *  one already in flight may have begun before the edit that prompted it. */
  async syncNow(): Promise<SyncStatus> {
    if (!this.running) return this.shown()
    const manual = new AbortController()
    this.manualAbort = manual

    // Only the leader talks to the server, and the tab someone is clicking in
    // is the one that should.
    if (!this.isLeader) {
      await new Promise<void>((resolve) => {
        this.leaderWaiters.push(resolve)
        void this.electLeader(true)
      })
    }

    // A sync that starts in the gap makes run() defer to it, so wait again.
    do {
      while (this.current) await this.current
      // Cancelled while queued: starting now would be the very request the
      // person just gave up on.
      if (manual.signal.aborted) return this.shown()
    } while (!(await this.run()))
    return this.shown()
  }

  /** Syncs often while realtime is down, and only as a backstop while it is up. */
  private poll() {
    if (this.inBackoff()) return
    const interval = this.realtimeUp ? POLL_INTERVAL_MS : OFFLINE_REALTIME_POLL_MS
    // A little slack, so a timer that fires a few ms early does not skip a turn.
    if (Date.now() - this.lastRunAt >= interval - 1_000) this.request()
  }

  /** The edit is on disk, which every tab shares. Only the leader talks to the
   *  server, so any other tab asks it to push rather than waiting for its poll. */
  private flushEdit() {
    if (this.isLeader) this.request()
    else this.statusChannel?.postMessage({ type: 'nudge' } satisfies StatusMessage)
  }

  /** Used by the retry affordance in the status menu. */
  retryNow() {
    this.failures = 0
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.emit({ error: null, retryAt: null })
    return this.syncNow()
  }

  /** Abandons the sync in progress. A request that never answers would
   *  otherwise hold every later sync behind it. */
  cancelSync() {
    this.manualAbort?.abort()
    this.requeue = false
    this.runAbort?.abort()
  }

  private listen<K extends string>(
    target: Window | Document,
    event: K,
    handler: () => void,
  ) {
    target.addEventListener(event, handler)
    this.cleanups.push(() => target.removeEventListener(event, handler))
  }

  /** One tab per origin does the talking. Duplicate pushes would be harmless —
   *  the CAS makes them idempotent — but they waste bandwidth and make the
   *  status indicator flicker between tabs for no reason.
   *
   *  The tab in front takes the lock from whoever has it (`steal`). Waiting
   *  politely is not enough: a phone freezes background tabs rather than
   *  closing them, and a frozen tab keeps its lock, so the tab actually being
   *  used would never get to sync. */
  private async electLeader(steal = false) {
    if (!this.running || this.isLeader) return

    if (!('locks' in navigator)) {
      this.becomeLeader(0)
      return
    }

    // Any earlier request from this tab is still queued behind the holder.
    this.lockAbort?.abort()
    const attempt = ++this.lockAttempt
    // `steal` is granted at once and cannot be combined with a signal; stop()
    // releases a held lock by resolving the promise below either way.
    const abort = steal ? null : new AbortController()
    this.lockAbort = abort

    try {
      await navigator.locks.request(
        `jottr:sync:${this.userId}`,
        steal ? { steal: true } : { signal: abort!.signal },
        async () => {
          if (!this.running) return
          this.becomeLeader(attempt)
          // Hold the lock for as long as this tab is the leader.
          await new Promise<void>((resolve) => {
            this.releaseLock = resolve
          })
        },
      )
    } catch {
      // Aborted before it was granted, or taken by another tab. Only the
      // second one matters, and is handled below.
    }

    if (this.running && this.isLeader && this.leaderAttempt === attempt) {
      // Another tab came to the front and took over. Queue up behind it, and
      // leave the syncing to it rather than finishing a cycle alongside it.
      this.isLeader = false
      this.dropRealtime()
      this.runAbort?.abort()
      void this.electLeader()
    }
  }

  private becomeLeader(attempt: number) {
    this.isLeader = true
    this.leaderAttempt = attempt
    this.subscribeRealtime()
    this.request()
    for (const resolve of this.leaderWaiters.splice(0)) resolve()
  }

  private openStatusChannel() {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(`jottr:sync-status:${this.userId}`)
    channel.onmessage = (event: MessageEvent<StatusMessage>) => this.onStatusMessage(event.data)
    this.statusChannel = channel
    channel.postMessage({ type: 'ask' } satisfies StatusMessage)
  }

  private onStatusMessage(message: StatusMessage | undefined) {
    if (message?.type === 'ask') {
      if (this.isLeader) this.statusChannel?.postMessage({ type: 'status', status: this.status })
    } else if (message?.type === 'nudge') {
      // The sending tab already waited out its own debounce.
      if (this.isLeader) this.request()
    } else if (message?.type === 'status' && !this.isLeader) {
      this.status = message.status
      this.notify()
    }
  }

  private recordOwnStamp(pageId: string, stamp: unknown) {
    const key = stampKey(stamp)
    if (!key) return
    // Echoes that never came, while realtime was down, would otherwise pile
    // up. Forgetting them only ever costs a cycle.
    if (this.ownStamps.size >= 1000) this.ownStamps.clear()
    this.ownStamps.add(`${pageId} ${key}`)
  }

  private dropRealtime() {
    if (this.channel) void this.supabase.removeChannel(this.channel)
    this.channel = null
    this.realtimeUp = false
  }

  private subscribeRealtime() {
    if (this.channel) return
    const bump = (event?: { new?: { id?: unknown; updated_at?: unknown } }) => {
      const stamp = stampKey(event?.new?.updated_at)
      if (stamp && this.ownStamps.delete(`${event?.new?.id} ${stamp}`)) return
      if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
      this.realtimeTimer = setTimeout(() => this.request(), REALTIME_DEBOUNCE_MS)
    }

    // Only pages. A saved document stamps its page row on the server, so this
    // one small row stands in for the blob, which realtime would otherwise
    // carry in full, twice over, to every device on every save.
    const channel = this.supabase
      .channel(`jottr:${this.userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pages', filter: `user_id=eq.${this.userId}` },
        bump,
      )
    this.channel = channel
    channel.subscribe((state) => {
      // A leftover callback from a channel this tab has since let go of.
      if (this.channel !== channel) return
      // Realtime is a hint, never the truth: every event turns into a REST
      // pull, and a reconnect just means pulling again from the cursor.
      this.realtimeUp = state === 'SUBSCRIBED'
      if (state === 'SUBSCRIBED') this.request()
    })
  }

  // --- status -------------------------------------------------------------

  /** A status identical to the current one is dropped here. Every keystroke
   *  recounts the pending pages, and mostly the count has not moved: passing
   *  that on would re-render everything that shows the sync state, and post it
   *  to every other tab, once per keystroke. */
  private emit(patch: Partial<SyncStatus>) {
    const keys = Object.keys(patch) as Array<keyof SyncStatus>
    if (keys.every((key) => patch[key] === this.status[key])) return
    this.status = { ...this.status, ...patch }
    this.notify()
    if (this.isLeader) {
      this.statusChannel?.postMessage({ type: 'status', status: this.status } satisfies StatusMessage)
    }
  }

  private notify() {
    const shown = this.shown()
    for (const listener of this.listeners) listener(shown)
  }

  /** The status with this tab's own failure to save laid over it. It is not
   *  sent to other tabs, whose edits may be saving fine. */
  private shown(): SyncStatus {
    const failure = saveFailure()
    if (!failure) return this.status
    return {
      ...this.status,
      // Another tab's count, when this one is not the leader, leaves out this
      // tab's unsaved edits, and sign-out warns only on a count above zero.
      pending: Math.max(this.status.pending, unsavedPages().length),
      phase: 'error',
      error: `A change couldn't be saved on this device: ${failure}`,
      retryAt: null,
    }
  }

  /** Recounts the pending pages for an edit: straight away, so the first edit
   *  after a sync shows at once, then at most every PENDING_RECOUNT_MS while
   *  edits keep coming, and once more after the last. Each count is three
   *  reads of the disk, and typing is an edit per keystroke. */
  private recountSoon() {
    if (this.recountTimer) {
      this.recountAgain = true
      return
    }
    void this.refreshPending()
    this.recountTimer = setTimeout(() => {
      this.recountTimer = null
      if (!this.recountAgain) return
      this.recountAgain = false
      this.recountSoon()
    }, PENDING_RECOUNT_MS)
  }

  private async refreshPending(patch: Partial<SyncStatus> = {}) {
    const pending = await countPending(this.db)

    // 'synced' claims everything on this device is on the server, so it can
    // only be told from 'pending' once the dirty rows have been counted — and
    // this is the one place that counts them. Offline, error and syncing are
    // explicit states about the connection and are left exactly as passed.
    let phase = patch.phase ?? this.status.phase
    if (phase === 'synced' || phase === 'pending') phase = pending > 0 ? 'pending' : 'synced'

    this.emit({ pending, ...patch, phase })
  }

  // --- the loop -----------------------------------------------------------

  /** False only when a sync was already in flight and this one was queued
   *  behind it rather than run. */
  private async run() {
    if (!this.running || !this.isLeader) return true
    if (!activeDatabase()) return true

    if (!navigator.onLine) {
      await this.refreshPending({ phase: 'offline' })
      return true
    }

    if (this.inFlight) {
      this.requeue = true
      return false
    }

    this.inFlight = true
    this.lastRunAt = Date.now()
    const job = this.cycle()
    this.current = job
    try {
      await job
    } catch (error) {
      // The cycle handles its own failures; this is it failing to record one,
      // e.g. the disk refusing the status write.
      this.emit({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Sync failed',
        retryAt: null,
      })
    } finally {
      if (this.current === job) this.current = null
    }
    return true
  }

  private async cycle() {
    const abort = new AbortController()
    this.runAbort = abort
    if (this.announceTimer) clearTimeout(this.announceTimer)
    this.announceTimer = setTimeout(() => {
      if (this.inFlight) this.emit({ phase: 'syncing' })
    }, SAVING_ANNOUNCE_MS)
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, this.cycleTimeoutMs)

    // The signal reaches each request's fetch, but not every wait in front of
    // one: supabase-js refreshes an expiring token before it sends anything,
    // and a refresh the network never answers holds getSession(), and every
    // request behind it, with no signal to stop it. Racing the abort settles
    // the cycle all the same, so a deadline or a cancel always frees the next.
    const abandoned = new Promise<never>((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(new Error('Sync abandoned')), { once: true })
    })

    try {
      await Promise.race([this.exchange(abort.signal), abandoned])

      const now = Date.now()
      await writeMeta(this.db, META_LAST_SYNCED, now)
      this.failures = 0
      // A retry still due from an earlier failure has nothing left to do.
      if (this.retryTimer) clearTimeout(this.retryTimer)
      this.retryTimer = null
      await this.refreshPending({
        phase: 'synced',
        lastSyncedAt: now,
        error: null,
        retryAt: null,
      })
    } catch (error) {
      if (abort.signal.aborted && !timedOut) {
        // Cancelled, not failed: no backoff, and whatever did not reach the
        // server is still marked dirty for the next attempt.
        await this.refreshPending({ phase: 'synced', error: null, retryAt: null })
        return
      }

      this.failures += 1
      const message = timedOut
        ? 'The server took too long to answer'
        : error instanceof Error
          ? error.message
          : 'Sync failed'

      if (!navigator.onLine) {
        await this.refreshPending({ phase: 'offline', error: null, retryAt: null })
      } else {
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.failures - 1))
        if (this.retryTimer) clearTimeout(this.retryTimer)
        // Straight to run(): request() would be held back by this very backoff.
        this.retryTimer = setTimeout(() => void this.run(), delay)
        await this.refreshPending({
          phase: 'error',
          error: message,
          retryAt: Date.now() + delay,
        })
      }
    } finally {
      clearTimeout(deadline)
      if (this.runAbort === abort) this.runAbort = null
      this.inFlight = false
      if (this.announceTimer) clearTimeout(this.announceTimer)
      this.announceTimer = null
      if (this.requeue) {
        this.requeue = false
        queueMicrotask(() => this.request())
      }
    }
  }

  // --- pull ---------------------------------------------------------------

  /** A document that could not be taken in is left for the next pull, and
   *  its error is returned rather than thrown, so the push still runs. */
  private async pull(signal: AbortSignal): Promise<Error | null> {
    await this.pullPages(signal)
    return this.pullDocs(signal)
  }

  /** Every row of `table` changed since `cursor`, less the overlap, oldest
   *  first, a page of rows at a time.
   *
   *  Keyset paging on (updated_at, id): with offsets, a row another device
   *  edits mid-scan moves to the end and shifts the rest left, so one row is
   *  never read, and the cursor then moves past it for good. The id breaks
   *  ties, since one transaction stamps every row it writes with the same
   *  time. */
  private async *changedSince<T extends { updated_at: string }>(
    table: string,
    columns: string,
    idColumn: keyof T & string,
    cursor: number,
    signal: AbortSignal,
  ): AsyncGenerator<T[]> {
    const since = new Date(Math.max(0, cursor - OVERLAP_MS)).toISOString()
    let last: T | null = null
    for (;;) {
      let query = this.supabase
        .from(table)
        .select(columns)
        .gte('updated_at', since)
        .order('updated_at', { ascending: true })
        .order(idColumn, { ascending: true })
      // The server's own timestamp string, which keeps the microseconds a
      // Date would round away.
      if (last) {
        const at = last.updated_at
        const id = String(last[idColumn])
        query = query.or(`updated_at.gt."${at}",and(updated_at.eq."${at}",${idColumn}.gt."${id}")`)
      }
      const { data, error } = await query.limit(PAGE_SIZE).abortSignal(signal)

      if (error) throw new Error(error.message)
      const rows = (data ?? []) as unknown as T[]
      if (rows.length > 0) yield rows
      if (rows.length < PAGE_SIZE) return
      last = rows[rows.length - 1]
    }
  }

  private async pullPages(signal: AbortSignal) {
    const cursor = await readMeta<number>(this.db, META_PAGES_CURSOR, 0)
    let newest = cursor

    for await (const rows of this.changedSince<ServerPage>('pages', '*', 'id', cursor, signal)) {
      const purged: string[] = []

      await this.db.transaction('rw', [this.db.pages, this.db.purges], async () => {
        const ids = rows.map((row) => row.id)
        const locals = await this.db.pages.bulkGet(ids)
        const queued = await this.db.purges.bulkGet(ids)
        for (const [index, row] of rows.entries()) {
          const serverUpdatedAt = Date.parse(row.updated_at)
          newest = Math.max(newest, serverUpdatedAt)

          // Deleted for good here, and the server has not heard yet: the pull
          // runs before the purge is sent, and would put the page back.
          if (queued[index]) continue

          // Deleted for good somewhere. That beats anything this device still
          // has waiting to push: the person emptied it from the trash.
          if (row.purged_at) {
            purged.push(row.id)
            continue
          }

          const local = locals[index]
          const server: Pick<PageRow, PageField> = {
            title: row.title,
            parentId: row.parent_id ?? '',
            sortKey: row.sort_key,
            isFavorite: row.is_favorite ? 1 : 0,
            deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : 0,
          }

          // A locally dirty row keeps the fields its own edit changed, which
          // the push that follows sends back, and takes the server's value for
          // the rest.
          if (local?.dirty) {
            const mine = new Set(local.dirtyFields ?? PAGE_FIELDS)
            const patch: Partial<PageRow> = { serverUpdatedAt }
            for (const field of PAGE_FIELDS) {
              if (!mine.has(field)) Object.assign(patch, { [field]: server[field] })
            }
            if (!changes(local, patch)) continue
            await this.db.pages.update(row.id, patch)
            continue
          }

          const next: PageRow = {
            id: row.id,
            ...server,
            searchText: local?.searchText ?? '',
            createdAt: Date.parse(row.created_at),
            updatedAt: serverUpdatedAt,
            editedAt: local?.editedAt,
            serverUpdatedAt,
            dirty: 0,
            origin: local?.origin ?? 'remote',
          }
          // The overlap window hands back this device's own recent pushes on
          // every cycle. Rewriting them unchanged would wake every live query
          // on the pages table, and re-render the sidebar, for nothing.
          if (local && !changes(local, next)) continue
          await this.db.pages.put(next)
        }
      })

      await forgetPages(this.db, purged)
    }

    if (newest > cursor) await writeMeta(this.db, META_PAGES_CURSOR, newest)
  }

  private async pullDocs(signal: AbortSignal): Promise<Error | null> {
    const cursor = await readMeta<number>(this.db, META_DOCS_CURSOR, 0)
    let newest = cursor
    const stale: string[] = []
    const changedAt = new Map<string, number>()

    // Versions first, blobs second. Most of what the overlap window returns is
    // this device's own last push, and re-downloading those blobs every cycle
    // would be the single most wasteful thing the app does.
    type Row = { page_id: string; version: number; updated_at: string }
    for await (const rows of this.changedSince<Row>(
      'page_docs',
      'page_id, version, updated_at',
      'page_id',
      cursor,
      signal,
    )) {
      const locals = await this.db.docStates.bulkGet(rows.map((row) => row.page_id))
      for (const [index, row] of rows.entries()) {
        const at = Date.parse(row.updated_at)
        newest = Math.max(newest, at)
        if (locals[index]?.version !== row.version) {
          stale.push(row.page_id)
          changedAt.set(row.page_id, at)
        }
      }
    }

    // A page deleted for good here keeps its row on the server until the
    // purge is sent. Downloading its document would bring it back.
    const queued = await this.db.purges.bulkGet(stale)
    const wanted = stale.filter((_, index) => !queued[index])
    let failure: Error | null = null
    let retryFrom = Infinity

    for (const chunk of chunks(wanted, BLOB_CHUNK)) {
      const { data, error } = await this.supabase
        .from('page_docs')
        .select('page_id, ydoc, version')
        .in('page_id', chunk)
        .abortSignal(signal)

      if (error) throw new Error(error.message)

      for (const row of (data ?? []) as Array<{ page_id: string; ydoc: string; version: number }>) {
        try {
          // Left at the old version when the disk refused it, so a push merges
          // with the server rather than being accepted over it.
          if (await applyRemoteUpdate(row.page_id, base64ToBytes(row.ydoc))) {
            await this.recordServerVersion(row.page_id, row.version)
          } else {
            failure ??= new Error('Could not save a page downloaded from the server')
            retryFrom = Math.min(retryFrom, changedAt.get(row.page_id) ?? cursor)
          }
          await this.syncTitleFromDoc(row.page_id)
        } catch (error) {
          // One document that cannot be read or stored must not hold back
          // every other page's download, or this device's uploads.
          if (signal.aborted) throw error
          failure ??= error instanceof Error ? error : new Error(String(error))
          retryFrom = Math.min(retryFrom, changedAt.get(row.page_id) ?? cursor)
        }
      }
    }

    // Held back to the first document that failed, so the next pull asks for
    // it again. Moved past it, the device would keep the old text for good
    // once the copy in memory was gone.
    const reached = Math.min(newest, retryFrom)
    if (reached > cursor) await writeMeta(this.db, META_DOCS_CURSOR, reached)
    return failure
  }

  private async recordServerVersion(pageId: string, version: number) {
    // A pull never clears dirty: local edits merged into the incoming state
    // still have to reach the server.
    await patchDocState(this.db, pageId, () => ({ version }))
  }

  /** The sidebar reads titles from the page row, but the truth is node 0 of the
   *  document. After a pull, bring the row back in line — without flagging it
   *  dirty, or every incoming edit would bounce straight back as a push.
   *
   *  After this device's own push it is flagged: the title in that document
   *  may be one typed moments ago that the editor has yet to copy onto the
   *  row, and once the row matches, the editor sees nothing to copy. Left
   *  clean, the server's row keeps its old title and the next pull puts it
   *  back. */
  private async syncTitleFromDoc(pageId: string, pushed = false) {
    const handle = loadedDoc(pageId)
    if (!handle) return
    const page = await this.db.pages.get(pageId)
    if (!page) return

    const title = readTitle(handle.doc)
    const searchText = readPlainText(handle.doc)
    if (page.title === title && page.searchText === searchText) return
    if (pushed && page.title !== title) {
      await touch(pageId, { title }, this.db)
      await this.db.pages.update(pageId, { searchText })
      return
    }
    await this.db.pages.update(pageId, { title, searchText })
  }

  private async exchange(signal: AbortSignal) {
    await this.requireSession()
    // A session that took past the deadline to arrive: this cycle has been
    // given up on, and a later one may already be running.
    signal.throwIfAborted()
    const pullFailure = await this.pull(signal)
    await this.reconcile(signal)
    await this.push(signal)
    if (pullFailure) throw pullFailure
  }

  /** With no session to hand — its token expired and the refresh has not
   *  gone through yet — supabase-js sends the anon key instead, and row-level
   *  security answers every read with an empty list rather than an error. A
   *  pull would learn nothing, and reconcile would take that emptiness as
   *  every page having been deleted and drop them all from this device. So a
   *  cycle waits for a real session, as it waits out any other failure. */
  private async requireSession() {
    const { data } = await this.supabase.auth.getSession()
    if (!data.session) throw new Error('Waiting to sign back in to the server')
  }

  // --- reconcile ----------------------------------------------------------

  /** Drops pages this device has from the server but the server no longer
   *  has. A pull only sees rows that changed, so a row that vanished outright
   *  — deleted before tombstones existed, or by hand in the dashboard — would
   *  otherwise live on here forever. */
  private async reconcile(signal: AbortSignal) {
    if (Date.now() - this.reconciledAt < RECONCILE_INTERVAL_MS) return

    // Keyset paging by id: unlike offsets, a row created or deleted by another
    // device mid-scan cannot shift a live id out of the pages being read, and
    // a missed id here would mean deleting a page that still exists.
    const live = new Set<string>()
    let after = ''
    for (;;) {
      // Tombstones are left out: a purged page is as gone as a missing one.
      let query = this.supabase
        .from('pages')
        .select('id')
        .is('purged_at', null)
        .order('id', { ascending: true })
      if (after) query = query.gt('id', after)
      const { data, error } = await query.limit(PAGE_SIZE).abortSignal(signal)

      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<{ id: string }>
      if (rows.length === 0) break
      for (const row of rows) live.add(row.id)
      after = rows[rows.length - 1].id
    }

    // Only rows the server has acknowledged. One it has never seen is new on
    // this device and is about to be pushed.
    const gone: string[] = []
    await this.db.pages
      .filter((page) => page.serverUpdatedAt > 0 && !live.has(page.id))
      .each((page) => {
        gone.push(page.id)
      })
    await forgetPages(this.db, gone)

    this.reconciledAt = Date.now()
  }

  // --- push ---------------------------------------------------------------

  private async push(signal: AbortSignal) {
    await this.pushPurges(signal)
    await this.pushPages(signal)
    await this.pushDocs(signal)
  }

  /** Permanent deletes queued while offline. Done before anything else so a
   *  purged page is never resurrected by a metadata push that follows it.
   *  The server keeps a tombstone rather than deleting the row, which is how
   *  every other device finds out. */
  private async pushPurges(signal: AbortSignal) {
    const queued = await this.db.purges.toArray()
    if (queued.length === 0) return

    for (const batch of chunks(queued, PUSH_BATCH)) {
      const ids = batch.map((row) => row.id)
      const { error } = await this.supabase.rpc('purge_pages', { p_ids: ids }).abortSignal(signal)
      if (error) throw new Error(error.message)
      await this.db.purges.bulkDelete(ids)
    }
  }

  private async pushPages(signal: AbortSignal) {
    const dirty = await this.db.pages.where('dirty').equals(1).toArray()
    if (dirty.length === 0) return

    // A row the server already has sends only the fields this device changed,
    // so it cannot write back a stale value over another device's edit to the
    // rest. The upsert updates only the columns it is given, and a request
    // gives every row the same columns, so rows are sent in groups that
    // changed the same fields.
    const groups = new Map<string, { fields: Set<PageField>; pages: PageRow[] }>()
    for (const page of dirty) {
      const changed = page.serverUpdatedAt ? (page.dirtyFields ?? PAGE_FIELDS) : PAGE_FIELDS
      const fields = PAGE_FIELDS.filter((field) => changed.includes(field))
      const key = fields.join()
      if (!groups.has(key)) groups.set(key, { fields: new Set(fields), pages: [] })
      groups.get(key)!.pages.push(page)
    }

    const batches = [...groups.values()].flatMap(({ fields, pages }) =>
      chunks(pages, PUSH_BATCH).map((batch) => ({ fields, batch })),
    )
    for (const { fields, batch } of batches) {
      const payload = batch.map((page: PageRow) => ({
        id: page.id,
        user_id: this.userId,
        created_at: new Date(page.createdAt).toISOString(),
        ...(fields.has('title') && { title: page.title }),
        ...(fields.has('parentId') && { parent_id: page.parentId || null }),
        ...(fields.has('sortKey') && { sort_key: page.sortKey }),
        ...(fields.has('isFavorite') && { is_favorite: page.isFavorite === 1 }),
        ...(fields.has('deletedAt') && {
          deleted_at: page.deletedAt ? new Date(page.deletedAt).toISOString() : null,
        }),
      }))

      const { data, error } = await this.supabase
        .from('pages')
        .upsert(payload, { onConflict: 'id' })
        .select('id, updated_at')
        .abortSignal(signal)

      if (error) throw new Error(error.message)

      const rows = (data ?? []) as Array<{ id: string; updated_at: string }>
      const stamps = new Map(rows.map((row) => [row.id, Date.parse(row.updated_at)]))
      for (const row of rows) this.recordOwnStamp(row.id, row.updated_at)

      await this.db.transaction('rw', this.db.pages, async () => {
        for (const page of batch) {
          const current = await this.db.pages.get(page.id)
          // Edited again while the request was in flight: leave it dirty.
          if (!current || current.updatedAt !== page.updatedAt) continue
          await this.db.pages.update(page.id, {
            dirty: 0,
            dirtyFields: [],
            serverUpdatedAt: stamps.get(page.id) ?? current.serverUpdatedAt,
          })
        }
      })
    }
  }

  private async pushDocs(signal: AbortSignal) {
    // A document with an edit the disk refused waits until it is saved: pushed
    // from memory, the server and the version would move on while the disk
    // still lacked the edit, and a reload would push over it.
    const unsaved = new Set(unsavedPages())
    const dirty = (await this.db.docStates.where('dirty').equals(1).toArray()).filter(
      (state) => !unsaved.has(state.pageId),
    )
    const queue = [
      ...dirty.filter((state) => !this.failedDocs.has(state.pageId)),
      ...dirty.filter((state) => this.failedDocs.has(state.pageId)),
    ]
    const errors: unknown[] = []

    // A few at a time. Each document is its own compare-and-swap, so they are
    // independent; one failing stops the others taking new work, and the
    // cycle reports it only once every request already sent has settled.
    const worker = async () => {
      for (let state = queue.shift(); state && errors.length === 0; state = queue.shift()) {
        try {
          await this.pushDoc(state, signal)
          this.failedDocs.delete(state.pageId)
        } catch (error) {
          if (!signal.aborted) this.failedDocs.add(state.pageId)
          errors.push(error)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, worker))
    if (errors.length) throw errors[0]
  }

  private async pushDoc(state: DocStateRow, signal: AbortSignal) {
    // Its page was dropped from this device; the document went with it on
    // the server too, so there is nowhere to push it.
    const page = await this.db.pages.get(state.pageId)
    if (!page) {
      await forgetPages(this.db, [state.pageId])
      return
    }

    let base = state.version

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      // Opened before anything is read from it, so the state vector below is
      // the document's, never null for a page nobody had open. An edit made
      // after this point moves it, and keeps the document dirty.
      const handle = await openDoc(state.pageId)
      // Another tab may have written rows this one never applied, such as a
      // pull it made while it was the leader. Pushed without them, the
      // compare-and-swap would accept this copy and erase them from the server.
      await refreshFromDisk(handle)
      const editsBefore = (await this.db.docStates.get(state.pageId))?.edits ?? 0
      const before = Y.encodeStateVector(handle.doc)
      const bytes = Y.encodeStateAsUpdate(handle.doc)

      const { data, error } = await this.supabase
        .rpc('push_page_doc', {
          p_page_id: state.pageId,
          p_ydoc: bytesToBase64(bytes),
          p_base_version: base,
        })
        .abortSignal(signal)

      if (error) throw new Error(error.message)

      const result = (
        data as Array<{ ydoc: string; version: number; applied: boolean; saved_at?: string | null }>
      )?.[0]
      if (!result) throw new Error('push_page_doc returned nothing')

      // The server has no live page for this document. If it once did, the
      // page was deleted for good on another device before this one heard,
      // so drop it now. If it never did, the row has yet to be uploaded:
      // leave the document dirty for the next sync.
      if (result.applied && result.version === 0) {
        if (page.serverUpdatedAt > 0) await forgetPages(this.db, [state.pageId])
        break
      }

      if (result.applied) {
        // Absent from a server that has not had schema.sql re-run, and then
        // nothing is recorded: the echo just costs a cycle, as it always did.
        this.recordOwnStamp(state.pageId, result.saved_at)
        const movedHere = !sameBytes(before, Y.encodeStateVector(handle.doc))
        await patchDocState(this.db, state.pageId, (current) => ({
          version: result.version,
          // `edits` also catches another tab's edit whose relay has not
          // reached this tab's copy of the document yet.
          dirty: movedHere || current.edits !== editsBefore ? 1 : 0,
        }))
        await this.syncTitleFromDoc(state.pageId, true)
        break
      }

      // The server moved on. Merge what it has — Yjs guarantees the union of
      // both edits, so nothing anyone typed is dropped — then retry at the
      // version we were just told about.
      // Not saved here, the page is now held back like any unsaved edit, and
      // pushing this copy on would leave the disk behind the server.
      if (!(await applyRemoteUpdate(state.pageId, base64ToBytes(result.ydoc)))) break
      base = result.version
      await this.recordServerVersion(state.pageId, result.version)

      if (attempt === MAX_CAS_ATTEMPTS - 1) {
        throw new Error('Could not settle a document after several attempts')
      }
    }
  }
}
