import 'fake-indexeddb/auto'
import type { SupabaseClient } from '@supabase/supabase-js'

/** A stand-in for the browser APIs the sync engine touches, so the engine can
 *  be driven under Node exactly as it runs in a tab. */
export function installBrowserGlobals() {
  const target = new EventTarget()
  const g = globalThis as unknown as Record<string, unknown>

  g.window = Object.assign(target, {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  })
  g.document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  // Node 24 ships a real `navigator` with only a getter, so it has to be
  // replaced outright rather than assigned through.
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  })
  // Left undefined on purpose: both the peer channel and the leader election
  // guard on these, and the fallbacks are what a locked-down browser gets.
  g.BroadcastChannel = undefined
}

export function setOnline(online: boolean) {
  ;(globalThis as unknown as { navigator: { onLine: boolean } }).navigator.onLine = online
}

interface PageRecord {
  id: string
  user_id: string
  title: string
  parent_id: string | null
  sort_key: string
  is_favorite?: boolean
  deleted_at: string | null
  purged_at?: string | null
  created_at: string
  updated_at: string
}

interface DocRecord {
  page_id: string
  ydoc: string
  version: number
  updated_at: string
}

/** An in-memory stand-in for Postgres + PostgREST, implementing exactly the
 *  surface the engine uses — including the compare-and-swap semantics of
 *  push_page_doc, which is the part that has to be right. */
export class FakeServer {
  pages = new Map<string, PageRecord>()
  docs = new Map<string, DocRecord>()
  /** Monotonic, so ordering never depends on how fast the test runs. */
  private clock = Date.parse('2026-01-01T00:00:00.000Z')
  counts = { select: 0, upsert: 0, rpc: 0, rpcRejected: 0, delete: 0, purge: 0, blobFetch: 0 }
  /** A network that never answers: queries hang until their signal aborts. */
  stalled = false
  /** Delay before push_page_doc answers, so overlapping pushes can be seen. */
  rpcDelayMs = 0
  /** Fails push_page_doc for this page, as a server error would. */
  failDocPush: string | null = null
  rpcInFlight = 0
  maxRpcInFlight = 0

  private stamp() {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }

  client(): SupabaseClient {
    const from = (table: string) => {
      const builder: Record<string, unknown> = {}
      let rows: Array<PageRecord | DocRecord> = []
      let mode: 'select' | 'upsert' | 'delete' = 'select'
      let payload: PageRecord[] = []
      let sinceIso: string | null = null
      let afterId: string | null = null
      let limit: number | null = null
      let inList: string[] | null = null
      let range: [number, number] | null = null
      let signal: AbortSignal | null = null
      const orders: string[] = []

      const run = () => {
        if (mode === 'upsert') {
          this.counts.upsert += 1
          const out = payload.flatMap((row) => {
            const existing = this.pages.get(row.id)
            // The keep_purged trigger: a tombstone is skipped, not an error.
            if (existing?.purged_at) return []
            const record: PageRecord = { ...(existing ?? row), ...row, updated_at: this.stamp() }
            this.pages.set(row.id, record)
            return [{ id: record.id, updated_at: record.updated_at }]
          })
          return { data: out, error: null }
        }

        if (mode === 'delete') {
          this.counts.delete += 1
          for (const id of inList ?? []) {
            this.pages.delete(id)
            this.docs.delete(id)
          }
          return { data: null, error: null }
        }

        this.counts.select += 1
        rows = table === 'pages' ? [...this.pages.values()] : [...this.docs.values()]

        if (sinceIso) rows = rows.filter((row) => row.updated_at >= sinceIso!)
        if (afterId !== null) rows = rows.filter((row) => (row as PageRecord).id > afterId!)
        if (inList) {
          this.counts.blobFetch += 1
          const wanted = new Set(inList)
          rows = rows.filter((row) => wanted.has((row as DocRecord).page_id))
        }
        for (const key of [...orders].reverse()) {
          rows = rows
            .slice()
            .sort((a, b) =>
              String((a as unknown as Record<string, unknown>)[key]) <
              String((b as unknown as Record<string, unknown>)[key])
                ? -1
                : 1,
            )
        }
        if (range) rows = rows.slice(range[0], range[1] + 1)
        if (limit !== null) rows = rows.slice(0, limit)
        return { data: rows, error: null }
      }

      Object.assign(builder, {
        select: () => builder,
        gte: (_column: string, value: string) => ((sinceIso = value), builder),
        gt: (_column: string, value: string) => ((afterId = value), builder),
        limit: (value: number) => ((limit = value), builder),
        order: (column: string) => (orders.push(column), builder),
        range: (a: number, b: number) => ((range = [a, b]), builder),
        in: (_column: string, values: string[]) => ((inList = values), builder),
        upsert: (value: PageRecord[]) => ((mode = 'upsert'), (payload = value), builder),
        delete: () => ((mode = 'delete'), builder),
        abortSignal: (value: AbortSignal) => ((signal = value), builder),
        then: (resolve: (value: unknown) => void) => {
          if (!this.stalled) return resolve(run())
          signal?.addEventListener('abort', () =>
            resolve({ data: null, error: { message: 'AbortError: signal is aborted' } }),
          )
        },
      })

      return builder
    }

    type PushParams = { p_page_id: string; p_ydoc: string; p_base_version: number }
    type PurgeParams = { p_ids: string[] }

    const rpc = (name: string, params: PushParams | PurgeParams) =>
      Object.assign(name === 'purge_pages' ? purge(params as PurgeParams) : delayed(params as PushParams), {
        abortSignal() {
          return this
        },
      })

    const delayed = async (params: PushParams) => {
      this.rpcInFlight += 1
      this.maxRpcInFlight = Math.max(this.maxRpcInFlight, this.rpcInFlight)
      try {
        if (this.rpcDelayMs) await new Promise((resolve) => setTimeout(resolve, this.rpcDelayMs))
        if (this.failDocPush === params.p_page_id) {
          return { data: null, error: { message: 'push_page_doc failed' } }
        }
        return await settle(params)
      } finally {
        this.rpcInFlight -= 1
      }
    }

    /** page_doc_saved: the page row is how other devices hear of the save. */
    const touchPage = (pageId: string) => {
      const page = this.pages.get(pageId)
      if (page) page.updated_at = this.stamp()
    }

    /** purge_pages: the document goes, the row stays behind as a tombstone. */
    const purge = (params: PurgeParams) => {
      this.counts.purge += 1
      for (const id of params.p_ids) {
        this.docs.delete(id)
        const existing = this.pages.get(id)
        if (existing?.purged_at) continue
        const now = this.stamp()
        this.pages.set(id, {
          id,
          user_id: existing?.user_id ?? '',
          title: '',
          parent_id: existing?.parent_id ?? null,
          sort_key: existing?.sort_key ?? 'a0',
          deleted_at: existing?.deleted_at ?? now,
          purged_at: now,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }

    const settle = (params: PushParams) => {
      this.counts.rpc += 1
      const page = this.pages.get(params.p_page_id)
      if (!page || page.purged_at) {
        return Promise.resolve({ data: [{ ydoc: '', version: 0, applied: true }], error: null })
      }
      const existing = this.docs.get(params.p_page_id)

      if (params.p_base_version <= 0 && !existing) {
        const record: DocRecord = {
          page_id: params.p_page_id,
          ydoc: params.p_ydoc,
          version: 1,
          updated_at: this.stamp(),
        }
        this.docs.set(record.page_id, record)
        touchPage(record.page_id)
        return Promise.resolve({ data: [{ ydoc: '', version: 1, applied: true }], error: null })
      }

      if (existing && existing.version === params.p_base_version) {
        existing.ydoc = params.p_ydoc
        existing.version += 1
        existing.updated_at = this.stamp()
        touchPage(existing.page_id)
        return Promise.resolve({
          data: [{ ydoc: '', version: existing.version, applied: true }],
          error: null,
        })
      }

      this.counts.rpcRejected += 1
      return Promise.resolve({
        data: [{ ydoc: existing?.ydoc ?? '', version: existing?.version ?? 0, applied: false }],
        error: null,
      })
    }

    const channel = () => {
      const ch = { on: () => ch, subscribe: () => ch }
      return ch
    }

    return { from, rpc, channel, removeChannel: () => {} } as unknown as SupabaseClient
  }
}
