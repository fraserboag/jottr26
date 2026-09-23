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
  type PageRow,
} from '@/lib/db/schema'
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
const EDIT_DEBOUNCE_MS = 1_200
/** Most syncs finish in well under a second. Announcing every one of them would
 *  make a working app look unstable, so the status only changes if a sync is
 *  still running after this long. */
const SAVING_ANNOUNCE_MS = 300
const REALTIME_DEBOUNCE_MS = 400
const MAX_CAS_ATTEMPTS = 6
const MAX_BACKOFF_MS = 30_000

interface ServerPage {
  id: string
  title: string
  parent_id: string | null
  sort_key: string
  deleted_at: string | null
  created_at: string
  updated_at: string
}

type Listener = (status: SyncStatus) => void

/** What tabs tell each other about sync. Only the leader talks to the server,
 *  so it is the only tab that knows how the last sync went; every other tab
 *  shows what it reports. */
type StatusMessage = { type: 'status'; status: SyncStatus } | { type: 'ask' }

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
  /** The sync in progress, so a manual sync can wait for it to finish. */
  private current: Promise<void> | null = null
  /** Aborts the requests of the sync in progress. */
  private runAbort: AbortController | null = null
  /** Manual syncs waiting for this tab to become the leader. */
  private leaderWaiters: Array<() => void> = []

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private announceTimer: ReturnType<typeof setTimeout> | null = null
  private editTimer: ReturnType<typeof setTimeout> | null = null
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
    this.pollTimer = setInterval(() => this.request(), POLL_INTERVAL_MS)

    this.cleanups.push(
      onLocalEdit(() => {
        void this.refreshPending()
        if (this.editTimer) clearTimeout(this.editTimer)
        this.editTimer = setTimeout(() => this.request(), EDIT_DEBOUNCE_MS)
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
    } while (!(await this.run()))
    return this.status
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
    channel.onmessage = (event: MessageEvent<StatusMessage>) => {
      const message = event.data
      if (message?.type === 'ask') {
        if (this.isLeader) channel.postMessage({ type: 'status', status: this.status })
      } else if (message?.type === 'status' && !this.isLeader) {
        this.status = message.status
        for (const listener of this.listeners) listener(this.status)
      }
    }
    this.statusChannel = channel
    channel.postMessage({ type: 'ask' } satisfies StatusMessage)
  }

  private subscribeRealtime() {
    if (this.channel) return
    const bump = () => {
      if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
      this.realtimeTimer = setTimeout(() => this.request(), REALTIME_DEBOUNCE_MS)
    }

    this.channel = this.supabase
      .channel(`jottr:${this.userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pages', filter: `user_id=eq.${this.userId}` },
        bump,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'page_docs', filter: `user_id=eq.${this.userId}` },
        bump,
      )
      .subscribe((state) => {
        // Realtime is a hint, never the truth: every event turns into a REST
        // pull, and a reconnect just means pulling again from the cursor.
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

    try {
      await this.pull(abort.signal)
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
      if (abort.signal.aborted) {
        // Cancelled, not failed: no backoff, and whatever did not reach the
        // server is still marked dirty for the next attempt.
        await this.refreshPending({ phase: 'synced', error: null, retryAt: null })
        return
      }

      this.failures += 1
      const message = error instanceof Error ? error.message : 'Sync failed'

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

      await this.db.transaction('rw', this.db.pages, async () => {
        for (const row of rows) {
          const serverUpdatedAt = Date.parse(row.updated_at)
          newest = Math.max(newest, serverUpdatedAt)

          const local = await this.db.pages.get(row.id)

          // A locally dirty row keeps its own metadata and wins the push that
          // follows. Titles self-heal regardless: they live inside the CRDT.
          if (local?.dirty) {
            await this.db.pages.update(row.id, { serverUpdatedAt })
            continue
          }

          await this.db.pages.put({
            id: row.id,
            title: row.title,
            parentId: row.parent_id ?? '',
            sortKey: row.sort_key,
            deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : 0,
            searchText: local?.searchText ?? '',
            createdAt: Date.parse(row.created_at),
            updatedAt: serverUpdatedAt,
            serverUpdatedAt,
            dirty: 0,
            origin: local?.origin ?? 'remote',
          })
        }
      })

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
   *  dirty, or every incoming edit would bounce straight back as a push. */
  private async syncTitleFromDoc(pageId: string) {
    const handle = loadedDoc(pageId)
    if (!handle) return
    const page = await this.db.pages.get(pageId)
    if (!page) return

    const title = readTitle(handle.doc)
    const searchText = readPlainText(handle.doc)
    if (page.title === title && page.searchText === searchText) return
    await this.db.pages.update(pageId, { title, searchText })
  }

  // --- push ---------------------------------------------------------------

  private async push(signal: AbortSignal) {
    await this.pushPurges(signal)
    await this.pushPages(signal)
    await this.pushDocs(signal)
  }

  /** Permanent deletes queued while offline. Done before anything else so a
   *  purged page is never resurrected by a metadata push that follows it. */
  private async pushPurges(signal: AbortSignal) {
    const queued = await this.db.purges.toArray()
    if (queued.length === 0) return

    for (let i = 0; i < queued.length; i += 100) {
      const batch = queued.slice(i, i + 100)
      const ids = batch.map((row) => row.id)
      const { error } = await this.supabase.from('pages').delete().in('id', ids).abortSignal(signal)
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
            serverUpdatedAt: stamps.get(page.id) ?? current.serverUpdatedAt,
          })
        }
      })
    }
  }

  private async pushDocs(signal: AbortSignal) {
    const dirty = await this.db.docStates.where('dirty').equals(1).toArray()

    for (const state of dirty) {
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
          await this.syncTitleFromDoc(state.pageId)
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
}
