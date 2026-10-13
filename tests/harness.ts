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
  workspace_id?: string
  workspace_deletion_id?: string | null
  title: string
  parent_id: string | null
  sort_key: string
  is_favorite?: boolean
  deleted_at: string | null
  purged_at?: string | null
  created_at: string
  updated_at: string
}

interface WorkspaceRecord {
  id: string
  user_id: string
  name: string
  sort_key?: string
  deleted_at: string | null
  purged_at: string | null
  state_token: string | null
  created_at: string
  updated_at: string
}

interface WorkspaceParams {
  p_operation_id: string
  p_workspace_id: string
  p_action: string
  p_expected_state: string | null
  p_page_id: string | null
  p_source_workspace_id?: string
  p_parent_id?: string | null
  p_sort_key?: string
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
  workspaces = new Map<string, WorkspaceRecord>()
  workspaceReceipts = new Map<string, { applied: boolean; reason?: string; source_workspace_id?: string }>()
  failWorkspaceSelectOnce = false
  afterWorkspaceOperation: (() => void) | null = null
  /** Monotonic, so ordering never depends on how fast the test runs. */
  private clock = Date.parse('2026-01-01T00:00:00.000Z')
  counts = { select: 0, upsert: 0, rpc: 0, rpcRejected: 0 }
  /** A network that never answers: queries hang until their signal aborts. */
  stalled = false
  /** Delay before push_page_doc answers, so overlapping pushes can be seen. */
  rpcDelayMs = 0
  /** Fails push_page_doc for this page, as a server error would. */
  failDocPush: string | null = null
  rpcInFlight = 0
  /** Delay before a download of document blobs answers, so overlapping
   *  downloads can be seen. */
  blobDelayMs = 0
  blobsInFlight = 0
  maxBlobsInFlight = 0
  /** What each client's realtime subscription was given, to fire events at. */
  realtimeHandlers: Array<(event: { new: Record<string, unknown> }) => void> = []
  maxRpcInFlight = 0
  /** Runs once a select has been answered, as another device writing between
   *  two page fetches would. */
  afterSelect: ((table: string, query: { unpurgedOnly: boolean }) => void) | null = null
  /** A session whose token expired and could not be refreshed yet: Supabase
   *  hands back no session, and would send reads as the anon user, whom
   *  row-level security shows nothing. */
  sessionLost = false
  /** A token refresh the network never answers: getSession() does not
   *  return, and it takes no signal to abort it by. */
  sessionHung = false
  /** Selects answered as the anon user though the session is back by the
   *  time anyone asks: a request sent in the moment between a token expiring
   *  and its refresh landing. */
  anonSelects = 0

  stamp() {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }

  client(accountId?: string): SupabaseClient {
    const from = (table: string) => {
      const builder: Record<string, unknown> = {}
      let rows: Array<PageRecord | DocRecord | WorkspaceRecord> = []
      let mode: 'select' | 'upsert' | 'update' = 'select'
      let payload: Array<PageRecord | WorkspaceRecord> = []
      let workspaceId: string | null = null
      let equalId: string | null = null
      let sinceIso: string | null = null
      let afterId: string | null = null
      let limit: number | null = null
      let inList: string[] | null = null
      let unpurgedOnly = false
      let counted = false
      let keyset: { at: string; column: string; id: string } | null = null
      let signal: AbortSignal | null = null
      const orders: string[] = []

      const run = () => {
        if (table === 'workspaces' && mode !== 'select') {
          for (const row of payload) {
            const existing = this.workspaces.get(equalId ?? row.id)
            if (existing?.purged_at) continue
            const candidate = { name: 'Pages', ...existing, ...row, user_id: row.user_id ?? existing?.user_id ?? accountId }
            if (!candidate.deleted_at && !candidate.purged_at && [...this.workspaces.values()].some((other) =>
              other.id !== (equalId ?? row.id) && other.user_id === candidate.user_id && !other.deleted_at && !other.purged_at &&
              other.name.trim().toLowerCase() === candidate.name.trim().toLowerCase(),
            )) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "workspaces_active_name_idx"' } }
          }
        }
        if (mode === 'update') {
          const workspace = equalId ? this.workspaces.get(equalId) : undefined
          if (!workspace || workspace.purged_at) return { data: [], error: null }
          Object.assign(workspace, payload[0], { updated_at: this.stamp() })
          return { data: [{ id: workspace.id, updated_at: workspace.updated_at }], error: null }
        }
        if (mode === 'upsert') {
          if (table === 'workspaces') {
            return { data: payload.flatMap((row) => {
              const existing = this.workspaces.get(row.id)
              if (existing?.purged_at) return []
              const stamp = this.stamp()
              const record = Object.assign(
                { name: 'Pages', deleted_at: null, purged_at: null, state_token: null },
                existing ?? {}, row, { updated_at: stamp },
              ) as WorkspaceRecord
              this.workspaces.set(row.id, record)
              return [{ id: row.id, updated_at: stamp }]
            }), error: null }
          }
          this.counts.upsert += 1
          const out = payload.flatMap((row) => {
            const existing = this.pages.get(row.id)
            // The keep_purged trigger: a tombstone is skipped, not an error.
            if (existing?.purged_at) return []
            const record = { ...(existing ?? row), ...row, updated_at: this.stamp() } as PageRecord
            if (!existing && record.parent_id) {
              const parent = this.pages.get(record.parent_id)
              if (parent?.workspace_id) record.workspace_id = parent.workspace_id
            }
            // Older sync tests do not pass an account ID to the fake client;
            // infer the stable default workspace from their first page upload.
            if (!accountId && record.workspace_id && !this.workspaces.has(record.workspace_id)) {
              const at = this.stamp()
              this.workspaces.set(record.workspace_id, { id: record.workspace_id, user_id: record.user_id, name: 'Pages', created_at: at, updated_at: at, deleted_at: null, purged_at: null, state_token: null })
            }
            const workspace = record.workspace_id ? this.workspaces.get(record.workspace_id) : undefined
            if (workspace?.purged_at) {
              record.purged_at = workspace.purged_at
              record.deleted_at = record.deleted_at || workspace.purged_at
              record.title = ''
            } else if (workspace?.deleted_at && !record.deleted_at) {
              record.deleted_at = workspace.deleted_at
              record.workspace_deletion_id = workspace.state_token
            } else if (workspace?.deleted_at && record.workspace_deletion_id) {
              if (!existing || !existing.deleted_at) {
                record.deleted_at = workspace.deleted_at
                record.workspace_deletion_id = workspace.state_token
              } else if (record.workspace_deletion_id !== existing.workspace_deletion_id) {
                record.deleted_at = existing.deleted_at
                record.workspace_deletion_id = existing.workspace_deletion_id
              }
            } else if (workspace && !workspace.deleted_at && record.workspace_deletion_id && record.workspace_deletion_id !== workspace.state_token) {
              if (!existing || record.workspace_deletion_id !== existing.workspace_deletion_id) {
                record.deleted_at = existing?.deleted_at ?? null
                record.workspace_deletion_id = existing?.workspace_deletion_id ?? null
              }
            }
            this.pages.set(row.id, record)
            return [{ id: record.id, updated_at: record.updated_at }]
          })
          return { data: out, error: null }
        }

        this.counts.select += 1
        if (table === 'workspaces' && this.failWorkspaceSelectOnce) {
          this.failWorkspaceSelectOnce = false
          return { data: null, error: { message: 'Space refresh interrupted' } }
        }
        if (this.sessionLost) return { data: [], error: null, count: counted ? 0 : null }
        if (this.anonSelects > 0) {
          this.anonSelects -= 1
          return { data: [], error: null, count: counted ? 0 : null }
        }
        rows = table === 'pages' ? [...this.pages.values()] : table === 'workspaces' ? [...this.workspaces.values()] : [...this.docs.values()]
        if (workspaceId) rows = rows.filter((row) => (row as PageRecord).workspace_id === workspaceId)
        if (equalId) rows = rows.filter((row) => (row as WorkspaceRecord).id === equalId)

        if (sinceIso) rows = rows.filter((row) => row.updated_at >= sinceIso!)
        if (afterId !== null) rows = rows.filter((row) => (row as PageRecord).id > afterId!)
        if (unpurgedOnly) rows = rows.filter((row) => !(row as PageRecord).purged_at)
        if (inList) {
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
        if (keyset) {
          const { at, column, id } = keyset
          rows = rows.filter((row) => {
            const key = String((row as unknown as Record<string, unknown>)[column])
            return row.updated_at > at || (row.updated_at === at && key > id)
          })
        }
        const count = counted ? rows.length : null
        if (limit !== null) rows = rows.slice(0, limit)
        this.afterSelect?.(table, { unpurgedOnly })
        return { data: rows, error: null, count }
      }

      Object.assign(builder, {
        select: (_columns?: string, options?: { count?: string }) => ((counted = Boolean(options?.count)), builder),
        gte: (_column: string, value: string) => ((sinceIso = value), builder),
        gt: (_column: string, value: string) => ((afterId = value), builder),
        eq: (column: string, value: string) => (column === 'id' ? (equalId = value) : (workspaceId = value), builder),
        limit: (value: number) => ((limit = value), builder),
        order: (column: string) => (orders.push(column), builder),
        // Only ever the keyset filter `changedSince` pages with.
        or: (filter: string) => {
          const match = /^updated_at\.gt\."(.+)",and\(updated_at\.eq\."\1",(\w+)\.gt\."(.+)"\)$/.exec(filter)
          if (!match) throw new Error(`unexpected filter: ${filter}`)
          keyset = { at: match[1], column: match[2], id: match[3] }
          return builder
        },
        in: (_column: string, values: string[]) => ((inList = values), builder),
        // Only ever `.is('purged_at', null)`.
        is: () => ((unpurgedOnly = true), builder),
        upsert: (value: PageRecord[] | WorkspaceRecord) => ((mode = 'upsert'), (payload = Array.isArray(value) ? value : [value]), builder),
        update: (value: WorkspaceRecord) => ((mode = 'update'), (payload = [value]), builder),
        abortSignal: (value: AbortSignal) => ((signal = value), builder),
        then: (resolve: (value: unknown) => void) => {
          if (!this.stalled && inList && this.blobDelayMs) {
            this.blobsInFlight += 1
            this.maxBlobsInFlight = Math.max(this.maxBlobsInFlight, this.blobsInFlight)
            setTimeout(() => {
              this.blobsInFlight -= 1
              resolve(run())
            }, this.blobDelayMs)
            return
          }
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

    const rpc = (name: string, params?: PushParams | PurgeParams | WorkspaceParams) =>
      Object.assign(name === 'ensure_default_workspace' ? bootstrap() : name === 'move_page_tree' ? moveTree(params as WorkspaceParams) : name === 'apply_workspace_operation' ? workspaceOperation(params as WorkspaceParams) : name === 'purge_pages' ? purge(params as PurgeParams) : delayed(params as PushParams), {
        abortSignal() {
          return this
        },
      })

    const moveTree = async (params: WorkspaceParams) => {
      const receipt = this.workspaceReceipts.get(params.p_operation_id)
      if (receipt) return { data: receipt, error: null }
      const root = params.p_page_id ? this.pages.get(params.p_page_id) : undefined
      const source = this.workspaces.get(params.p_source_workspace_id ?? '')
      const destination = this.workspaces.get(params.p_workspace_id)
      const parent = params.p_parent_id ? this.pages.get(params.p_parent_id) : undefined
      const result: { applied: boolean; reason?: string; source_workspace_id?: string } = {
        applied: true, source_workspace_id: root?.workspace_id ?? params.p_source_workspace_id,
      }
      if (!source || source.deleted_at || source.purged_at || !destination || destination.deleted_at || destination.purged_at ||
          (root && (root.workspace_id !== params.p_source_workspace_id || root.deleted_at || root.purged_at)) ||
          (parent && (parent.workspace_id !== params.p_workspace_id || parent.deleted_at || parent.purged_at))) {
        result.applied = false
        result.reason = 'Page or space changed on another device.'
      } else if (root) {
        const ids = new Set([root.id])
        for (let previous = -1; previous !== ids.size;) {
          previous = ids.size
          for (const page of this.pages.values()) if (page.parent_id && ids.has(page.parent_id) && page.workspace_id === root.workspace_id && !page.purged_at) ids.add(page.id)
        }
        if (params.p_parent_id && ids.has(params.p_parent_id)) { result.applied = false; result.reason = 'Cannot move into its own subtree.' }
        else {
          for (const id of ids) {
            const page = this.pages.get(id)!
            page.workspace_id = params.p_workspace_id
            page.workspace_deletion_id = null
            page.updated_at = this.stamp()
          }
          root.parent_id = params.p_parent_id ?? null
          root.sort_key = params.p_sort_key ?? 'a0'
        }
      }
      this.workspaceReceipts.set(params.p_operation_id, result)
      this.afterWorkspaceOperation?.()
      return { data: result, error: null }
    }

    const bootstrap = async () => {
      if (accountId && !this.workspaces.has(accountId)) {
        const at = this.stamp()
        this.workspaces.set(accountId, { id: accountId, user_id: accountId, name: 'Pages', created_at: at, updated_at: at, deleted_at: null, purged_at: null, state_token: null })
      }
      return { data: null, error: null }
    }

    const workspaceOperation = async (params: WorkspaceParams) => {
      const previous = this.workspaceReceipts.get(params.p_operation_id)
      if (previous) return { data: previous, error: null }
      const workspace = this.workspaces.get(params.p_workspace_id)
      let result: { applied: boolean; reason?: string } = { applied: true }
      const notes = [...this.pages.values()].filter((page) => page.workspace_id === workspace?.id && !page.purged_at)
      if (!workspace || workspace.purged_at || workspace.state_token !== params.p_expected_state) {
        result = { applied: false, reason: 'Space changed on another device.' }
      } else if (params.p_action === 'delete' && [...this.workspaces.values()].filter((row) => !row.deleted_at && !row.purged_at).length <= 1) {
        result = { applied: false, reason: 'Keep at least one space.' }
      } else {
        const at = this.stamp()
        const token = workspace.state_token
        workspace.updated_at = at
        workspace.state_token = params.p_operation_id
        if (params.p_action === 'delete') {
          workspace.deleted_at = at
          for (const note of notes) if (!note.deleted_at) {
            note.deleted_at = at
            note.workspace_deletion_id = params.p_operation_id
            note.updated_at = this.stamp()
          }
        } else if (params.p_action === 'restore') {
          workspace.deleted_at = null
          for (const note of notes) if (note.workspace_deletion_id === token) {
            note.deleted_at = null
            note.workspace_deletion_id = null
            note.updated_at = this.stamp()
          }
        } else if (params.p_action === 'restorePage') {
          workspace.deleted_at = null
          const target = notes.find((note) => note.id === params.p_page_id)
          if (target) {
            target.deleted_at = null
            target.workspace_deletion_id = null
            target.updated_at = this.stamp()
          }
          if (target && notes.find((note) => note.id === target.parent_id)?.deleted_at) target.parent_id = null
        } else if (params.p_action === 'purge') {
          workspace.purged_at = at
          for (const note of notes) {
            this.docs.delete(note.id)
            note.purged_at = at
            note.title = ''
            note.updated_at = this.stamp()
          }
        }
      }
      this.workspaceReceipts.set(params.p_operation_id, result)
      this.afterWorkspaceOperation?.()
      return { data: result, error: null }
    }

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
      // As the anon user, row-level security hides every page, so the real
      // function finds none and answers as it does for a purged one.
      const page = this.sessionLost ? undefined : this.pages.get(params.p_page_id)
      if (!page || page.purged_at) {
        return Promise.resolve({ data: [{ ydoc: '', version: 0, applied: true, saved_at: null }], error: null })
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
        return Promise.resolve({
          data: [{ ydoc: '', version: 1, applied: true, saved_at: page.updated_at }],
          error: null,
        })
      }

      if (existing && existing.version === params.p_base_version) {
        existing.ydoc = params.p_ydoc
        existing.version += 1
        existing.updated_at = this.stamp()
        touchPage(existing.page_id)
        return Promise.resolve({
          data: [{ ydoc: '', version: existing.version, applied: true, saved_at: page.updated_at }],
          error: null,
        })
      }

      this.counts.rpcRejected += 1
      return Promise.resolve({
        data: [{ ydoc: existing?.ydoc ?? '', version: existing?.version ?? 0, applied: false, saved_at: null }],
        error: null,
      })
    }

    const channel = () => {
      const ch = {
        on: (_type: string, _filter: unknown, handler: (event: { new: Record<string, unknown> }) => void) => {
          this.realtimeHandlers.push(handler)
          return ch
        },
        subscribe: () => ch,
      }
      return ch
    }

    const auth = {
      getSession: async () => {
        if (this.sessionHung) await new Promise(() => {})
        return { data: { session: this.sessionLost ? null : { access_token: 'token' } }, error: null }
      },
    }

    return { from, rpc, channel, auth, removeChannel: () => {} } as unknown as SupabaseClient
  }
}
