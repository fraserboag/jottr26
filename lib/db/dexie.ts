import Dexie, { type EntityTable } from 'dexie'
import type { DocStateRow, DocUpdateRow, MetaRow, NoteWorkspaceRow, PageRow, PurgeRow, WorkspaceOperationRow } from './schema'

export type JottrDB = Dexie & {
  pages: EntityTable<PageRow, 'id'>
  docStates: EntityTable<DocStateRow, 'pageId'>
  docUpdates: EntityTable<DocUpdateRow, 'seq'>
  purges: EntityTable<PurgeRow, 'id'>
  meta: EntityTable<MetaRow, 'key'>
  workspaces: EntityTable<NoteWorkspaceRow, 'id'>
  workspaceOperations: EntityTable<WorkspaceOperationRow, 'seq'>
}

/** One database per account, so signing into a second account on a shared
 *  device can never surface the first account's notes. */
export function databaseName(userId: string) {
  return `jottr:${userId}`
}

/** Open handles, keyed by account. In the app there is only ever one, but
 *  keeping them rather than closing on every call means an in-flight write can
 *  never land against a handle that was closed underneath it. Sign-out closes
 *  and deletes through eraseDatabase. */
const open = new Map<string, JottrDB>()
let current: { userId: string; db: JottrDB } | null = null

export function openDatabase(userId: string): JottrDB {
  if (current?.userId === userId) return current.db

  const cached = open.get(userId)
  if (cached) {
    current = { userId, db: cached }
    return cached
  }

  const db = new Dexie(databaseName(userId)) as JottrDB
  // v2 dropped the `isFavorite` index when favourites were removed. An index
  // can only be removed by a version bump — declaring the new shape under v1
  // would throw against a database already on disk. Favourites are back, but
  // as a plain field: the sidebar filters the pages it already has, so they
  // need no index and no bump.
  db.version(2).stores({
    pages: 'id, parentId, dirty, updatedAt, deletedAt, [deletedAt+parentId]',
    docStates: 'pageId, dirty',
    docUpdates: '++seq, pageId',
    purges: 'id',
    meta: 'key',
  })

  db.version(3).stores({
    pages: 'id, workspaceId, parentId, dirty, updatedAt, deletedAt, [deletedAt+parentId], [workspaceId+deletedAt+parentId]',
    workspaces: 'id, dirty, deletedAt, createdAt',
    workspaceOperations: '++seq, workspaceId',
  }).upgrade(async (transaction) => {
    await transaction.table('workspaces').put(defaultWorkspace(userId))
    await transaction.table('pages').toCollection().modify((page) => {
      page.workspaceId = userId
      page.workspaceDeletionId = ''
    })
  })
  // Remove retired colour metadata while preserving pending names and order.
  db.version(4).stores({}).upgrade(async (transaction) => {
    await transaction.table('workspaces').toCollection().modify((workspace) => {
      delete workspace.color
      workspace.dirtyFields = workspace.dirtyFields.filter((field: string) => field !== 'color')
      if (workspace.serverUpdatedAt && workspace.dirtyFields.length === 0) workspace.dirty = 0
    })
  })
  db.on('populate', async (transaction) => {
    await transaction.table('workspaces').put(defaultWorkspace(userId))
  })

  open.set(userId, db)
  current = { userId, db }
  return db
}

/** The auth UUID is also the stable ID of the initial Pages workspace, so
 *  migration on two devices never makes two copies. */
function defaultWorkspace(userId: string): NoteWorkspaceRow {
  return {
    id: userId, name: 'Pages', createdAt: 0, updatedAt: 0,
    serverUpdatedAt: 0, deletedAt: 0, purgedAt: 0, stateToken: '', dirty: 0, dirtyFields: [],
  }
}

export function defaultWorkspaceId(database: JottrDB) {
  return database.name.slice('jottr:'.length)
}

/** The open database, or null before sign-in. UI reads go through this so a
 *  signed-out render never throws. */
export function activeDatabase(): JottrDB | null {
  return current?.db ?? null
}

/** Databases this app closed, as opposed to ones the browser closed under it,
 *  which Dexie reopens on the next write. Dexie's own hasBeenClosed() cannot
 *  tell them apart: it looks for an error name Dexie never uses. */
const closedHere = new WeakSet<JottrDB>()

export function closedByApp(db: JottrDB) {
  return closedHere.has(db)
}

export function closeDatabase() {
  for (const db of open.values()) {
    closedHere.add(db)
    db.close()
  }
  open.clear()
  current = null
}

/** Used when signing out: the notes are cloud-backed, and leaving them in
 *  IndexedDB on a device someone else may use is not a tradeoff worth making. */
export async function eraseDatabase(userId: string) {
  const db = open.get(userId)
  if (db) closedHere.add(db)
  db?.close()
  open.delete(userId)
  if (current?.userId === userId) current = null
  await Dexie.delete(databaseName(userId))
}

export async function readMeta<T>(db: JottrDB, key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function writeMeta(db: JottrDB, key: string, value: unknown) {
  await db.meta.put({ key, value })
}
