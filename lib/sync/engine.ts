import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
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
  encodeState,
  onLocalEdit,
  readPlainText,
  readTitle,
  loadedDoc,
  sameBytes,
  stateVector,
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
  private cleanups: Array<() => void> = []

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
        void this.refreshPending()
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

    void this.electLeader(document.visibilityState === 'visible')
  }

  stop() {
    this.running = false
    this.isLeader = false
    this.lockAbort?.abort()
    this.lockAbort = null
    this.runAbort?.abort()
    for (const resolve of this.leaderWaiters.splice(0)) resolve()
    if (this.channel) void this.supabase.removeChannel(this.channel)
    this.channel = null
    this.realtimeUp = false
    this.statusChannel?.close()
    this.statusChannel = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.announceTimer) clearTimeout(this.announceTimer)
    if (this.editTimer) clearTimeout(this.editTimer)
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    closePeerChannel()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  getStatus() {
    return this.status
  }

  /** Ask for a sync now. Safe to call as often as you like. */
  request() {
    void this.run()
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
    if (!this.running) return this.status
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
      if (manual.signal.aborted) return this.status
    } while (!(await this.run()))
    return this.status
  }

  /** Syncs often while realtime is down, and only as a backstop while it is up. */
  private poll() {
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
            this.cleanups.push(resolve)
          })
        },
      )
    } catch {
      // Aborted before it was granted, or taken by another tab. Only the
      // second one matters, and is handled below.
    }

    if (this.running && this.isLeader && this.leaderAttempt === attempt) {
      // Another tab came to the front and took over. Queue up behind it.
      this.isLeader = false
      if (this.channel) void this.supabase.removeChannel(this.channel)
      this.channel = null
      this.realtimeUp = false
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
      for (const listener of this.listeners) listener(this.status)
    }
  }

  private subscribeRealtime() {
    if (this.channel) return
    const bump = () => {
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

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    for (const listener of this.listeners) listener(this.status)
    if (this.isLeader) {
      this.statusChannel?.postMessage({ type: 'status', status: this.status } satisfies StatusMessage)
    }
  }

  private async refreshPending(patch: Partial<SyncStatus> = {}) {
    const [pages, docs] = await Promise.all([
      this.db.pages.where('dirty').equals(1).primaryKeys(),
      this.db.docStates.where('dirty').equals(1).primaryKeys(),
    ])
    const pending = new Set([...pages, ...docs] as string[]).size

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

    try {
      await this.pull(abort.signal)
      await this.reconcile(abort.signal)
      await this.push(abort.signal)

      const now = Date.now()
      await writeMeta(this.db, META_LAST_SYNCED, now)
      this.failures = 0
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
        this.retryTimer = setTimeout(() => this.request(), delay)
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

  private async pull(signal: AbortSignal) {
    await this.pullPages(signal)
    await this.pullDocs(signal)
  }

  private async pullPages(signal: AbortSignal) {
    const cursor = await readMeta<number>(this.db, META_PAGES_CURSOR, 0)
    const since = new Date(Math.max(0, cursor - OVERLAP_MS)).toISOString()
    let offset = 0
    let newest = cursor

    for (;;) {
      const { data, error } = await this.supabase
        .from('pages')
        .select('*')
        .gte('updated_at', since)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
        .abortSignal(signal)

      if (error) throw new Error(error.message)
      const rows = (data ?? []) as ServerPage[]
      if (rows.length === 0) break

      const purged: string[] = []

      await this.db.transaction('rw', this.db.pages, async () => {
        for (const row of rows) {
          const serverUpdatedAt = Date.parse(row.updated_at)
          newest = Math.max(newest, serverUpdatedAt)

          // Deleted for good somewhere. That beats anything this device still
          // has waiting to push: the person emptied it from the trash.
          if (row.purged_at) {
            purged.push(row.id)
            continue
          }

          const local = await this.db.pages.get(row.id)
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
            await this.db.pages.update(row.id, patch)
            continue
          }

          await this.db.pages.put({
            id: row.id,
            ...server,
            searchText: local?.searchText ?? '',
            createdAt: Date.parse(row.created_at),
            updatedAt: serverUpdatedAt,
            editedAt: local?.editedAt,
            serverUpdatedAt,
            dirty: 0,
            origin: local?.origin ?? 'remote',
          })
        }
      })

      await forgetPages(this.db, purged)

      if (rows.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (newest > cursor) await writeMeta(this.db, META_PAGES_CURSOR, newest)
  }

  private async pullDocs(signal: AbortSignal) {
    const cursor = await readMeta<number>(this.db, META_DOCS_CURSOR, 0)
    const since = new Date(Math.max(0, cursor - OVERLAP_MS)).toISOString()
    let offset = 0
    let newest = cursor
    const stale: string[] = []

    // Versions first, blobs second. Most of what the overlap window returns is
    // this device's own last push, and re-downloading those blobs every cycle
    // would be the single most wasteful thing the app does.
    for (;;) {
      const { data, error } = await this.supabase
        .from('page_docs')
        .select('page_id, version, updated_at')
        .gte('updated_at', since)
        .order('updated_at', { ascending: true })
        .order('page_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
        .abortSignal(signal)

      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<{ page_id: string; version: number; updated_at: string }>
      if (rows.length === 0) break

      for (const row of rows) {
        newest = Math.max(newest, Date.parse(row.updated_at))
        const local = await this.db.docStates.get(row.page_id)
        if (!local || local.version !== row.version) stale.push(row.page_id)
      }

      if (rows.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    for (let i = 0; i < stale.length; i += BLOB_CHUNK) {
      const chunk = stale.slice(i, i + BLOB_CHUNK)
      const { data, error } = await this.supabase
        .from('page_docs')
        .select('page_id, ydoc, version')
        .in('page_id', chunk)
        .abortSignal(signal)

      if (error) throw new Error(error.message)

      for (const row of (data ?? []) as Array<{ page_id: string; ydoc: string; version: number }>) {
        await applyRemoteUpdate(row.page_id, base64ToBytes(row.ydoc))
        await this.recordServerVersion(row.page_id, row.version)
        await this.syncTitleFromDoc(row.page_id)
      }
    }

    if (newest > cursor) await writeMeta(this.db, META_DOCS_CURSOR, newest)
  }

  private async recordServerVersion(pageId: string, version: number) {
    const existing = await this.db.docStates.get(pageId)
    await this.db.docStates.put({
      pageId,
      snapshot: existing?.snapshot ?? new Uint8Array(),
      version,
      // A pull never clears dirty: local edits merged into the incoming state
      // still have to reach the server.
      dirty: existing?.dirty ?? 0,
      updateCount: existing?.updateCount ?? 0,
    })
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
      let query = this.supabase.from('pages').select('id, purged_at').order('id', { ascending: true })
      if (after) query = query.gt('id', after)
      const { data, error } = await query.limit(PAGE_SIZE).abortSignal(signal)

      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<{ id: string; purged_at: string | null }>
      if (rows.length === 0) break
      for (const row of rows) if (!row.purged_at) live.add(row.id)
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

    for (let i = 0; i < queued.length; i += 100) {
      const batch = queued.slice(i, i + 100)
      const ids = batch.map((row) => row.id)
      const { error } = await this.supabase.rpc('purge_pages', { p_ids: ids }).abortSignal(signal)
      if (error) throw new Error(error.message)
      await this.db.purges.bulkDelete(ids)
    }
  }

  private async pushPages(signal: AbortSignal) {
    const dirty = await this.db.pages.where('dirty').equals(1).toArray()
    if (dirty.length === 0) return

    for (let i = 0; i < dirty.length; i += 100) {
      const batch = dirty.slice(i, i + 100)
      const payload = batch.map((page: PageRow) => ({
        id: page.id,
        user_id: this.userId,
        title: page.title,
        parent_id: page.parentId || null,
        sort_key: page.sortKey,
        is_favorite: page.isFavorite === 1,
        deleted_at: page.deletedAt ? new Date(page.deletedAt).toISOString() : null,
        created_at: new Date(page.createdAt).toISOString(),
      }))

      const { data, error } = await this.supabase
        .from('pages')
        .upsert(payload, { onConflict: 'id' })
        .select('id, updated_at')
        .abortSignal(signal)

      if (error) throw new Error(error.message)

      const stamps = new Map(
        ((data ?? []) as Array<{ id: string; updated_at: string }>).map((row) => [
          row.id,
          Date.parse(row.updated_at),
        ]),
      )

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
    const queue = await this.db.docStates.where('dirty').equals(1).toArray()
    const errors: unknown[] = []

    // A few at a time. Each document is its own compare-and-swap, so they are
    // independent; one failing stops the others taking new work, and the
    // cycle reports it only once every request already sent has settled.
    const worker = async () => {
      for (let state = queue.shift(); state && errors.length === 0; state = queue.shift()) {
        try {
          await this.pushDoc(state, signal)
        } catch (error) {
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
      const before = stateVector(state.pageId)
      const bytes = await encodeState(state.pageId)

      const { data, error } = await this.supabase
        .rpc('push_page_doc', {
          p_page_id: state.pageId,
          p_ydoc: bytesToBase64(bytes),
          p_base_version: base,
        })
        .abortSignal(signal)

      if (error) throw new Error(error.message)

      const result = (data as Array<{ ydoc: string; version: number; applied: boolean }>)?.[0]
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
        const after = stateVector(state.pageId)
        const movedWhileInFlight = before !== null && !sameBytes(before, after)
        const current = await this.db.docStates.get(state.pageId)
        await this.db.docStates.put({
          pageId: state.pageId,
          snapshot: current?.snapshot ?? new Uint8Array(),
          version: result.version,
          dirty: movedWhileInFlight ? 1 : 0,
          updateCount: current?.updateCount ?? 0,
        })
        await this.syncTitleFromDoc(state.pageId, true)
        break
      }

      // The server moved on. Merge what it has — Yjs guarantees the union of
      // both edits, so nothing anyone typed is dropped — then retry at the
      // version we were just told about.
      await applyRemoteUpdate(state.pageId, base64ToBytes(result.ydoc))
      base = result.version
      await this.recordServerVersion(state.pageId, result.version)

      if (attempt === MAX_CAS_ATTEMPTS - 1) {
        throw new Error('Could not settle a document after several attempts')
      }
    }
  }
}
