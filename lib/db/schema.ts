/** Local row shapes. Everything the UI renders comes from here, never from the
 *  network — that is what makes navigation instant and offline unremarkable.
 *
 *  Booleans and nulls are avoided on indexed fields: IndexedDB will not index
 *  either, so `parentId` uses '' for a root page and `deletedAt` uses 0 for a
 *  live one. */

export interface PageRow {
  id: string
  workspaceId: string
  /** The workspace deletion that moved this page to Trash, or ''. */
  workspaceDeletionId: string
  title: string
  /** '' means the page sits at the root. */
  parentId: string
  sortKey: string
  /** Not indexed: the sidebar picks favourites out of the pages it already
   *  holds. Missing on rows written before favourites came back, which reads
   *  as not a favourite. */
  isFavorite?: 0 | 1
  /** Epoch ms, or 0 when the page is not in the trash. */
  deletedAt: number
  createdAt: number
  /** Local edit time, used to resolve metadata races against the server. */
  updatedAt: number
  /** When this device last changed the document itself, as builds before
   *  2026-09-27 kept it. It now lives in `meta` (see editedAt.ts), since
   *  typing rewrote the row for it; this is only read as a fallback. */
  editedAt?: number
  /** The server's updated_at as we last received it. 0 = never synced. */
  serverUpdatedAt: number
  /** Metadata differs from the server and needs pushing. */
  dirty: 0 | 1
  /** Which fields the unpushed edit changed. A pull adopts the server's value
   *  for every other field, so trashing a page on one device survives a rename
   *  of it on another. Missing on rows written before this existed, which are
   *  treated as dirty in every field. */
  dirtyFields?: PageField[]
  /** Where the page's search text lived before it moved to `meta` (see
   *  searchText.ts). Only on rows an older build wrote since the move. */
  searchText?: string
  /** 'local' pages were created on this device and own their initial content;
   *  'remote' pages must wait for their document to arrive before editing. */
  origin: 'local' | 'remote'
}

/** The metadata a device can change and push. */
export const PAGE_FIELDS = ['title', 'parentId', 'sortKey', 'isFavorite', 'deletedAt', 'workspaceId', 'workspaceDeletionId'] as const
export type PageField = (typeof PAGE_FIELDS)[number]

export type WorkspaceField = 'name' | 'sortKey'

export interface NoteWorkspaceRow {
  id: string
  name: string
  /** Unordered older rows use creation order until the first reorder. */
  sortKey?: string
  createdAt: number
  updatedAt: number
  serverUpdatedAt: number
  deletedAt: number
  purgedAt: number
  stateToken: string
  dirty: 0 | 1
  dirtyFields: WorkspaceField[]
}

/** Lifecycle changes are explicit, ordered and idempotent, unlike metadata
 *  edits. Retried operations must not repeat a deletion after restoration. */
export interface WorkspaceOperationRow {
  seq?: number
  id: string
  workspaceId: string
  action: 'delete' | 'restore' | 'restorePage' | 'purge' | 'movePage'
  expectedState: string
  pageId: string
  queuedAt: number
  /** Keep the operation until its canonical state has also reached disk. */
  acknowledged?: boolean
  sourceWorkspaceId?: string
  sourceParentId?: string
  sourceSortKey?: string
  parentId?: string
  sortKey?: string
  pageIds?: string[]
}

export interface DocStateRow {
  pageId: string
  /** Compacted Yjs state, as builds before 2026-09-26 kept it. Empty once
   *  this build has compacted the page: the compacted state is then a row in
   *  `docUpdates`, since this row is rewritten on every edit. Read as the
   *  base the `docUpdates` rows apply to. */
  snapshot: Uint8Array
  /** Server compare-and-swap token. 0 = the server has never seen this doc. */
  version: number
  /** Document content differs from the server and needs pushing. */
  dirty: 0 | 1
  /** Counts local edits, and never goes down. A push clears `dirty` only if
   *  this has not moved since it started, so an edit that lands mid-push — in
   *  this tab or another — is never marked as already on the server. Rows
   *  written before it existed read as 0. */
  edits: number
}

export interface DocUpdateRow {
  seq?: number
  pageId: string
  update: Uint8Array
}

/** Pages the user deleted for good. Held until the server confirms, so that
 *  emptying the trash works on a plane like everything else. */
export interface PurgeRow {
  id: string
  queuedAt: number
}

export interface MetaRow {
  key: string
  value: unknown
}

/** Server watermarks. Stored as the server's own timestamps so a skewed client
 *  clock can never cause a row to be skipped. */
export const META_PAGES_CURSOR = 'cursor:pages'
export const META_WORKSPACES_CURSOR = 'cursor:workspaces'
export const META_DOCS_CURSOR = 'cursor:page_docs'
export const META_LAST_SYNCED = 'lastSyncedAt'
