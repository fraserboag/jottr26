import Dexie, { type EntityTable } from 'dexie'
import type { DocStateRow, DocUpdateRow, MetaRow, PageRow, PurgeRow } from './schema'

export type JottrDB = Dexie & {
  pages: EntityTable<PageRow, 'id'>
  docStates: EntityTable<DocStateRow, 'pageId'>
  docUpdates: EntityTable<DocUpdateRow, 'seq'>
  purges: EntityTable<PurgeRow, 'id'>
  meta: EntityTable<MetaRow, 'key'>
}

/** One database per account, so signing into a second account on a shared
 *  device can never surface the first account's notes. */
export function databaseName(userId: string) {
  return `jottr:${userId}`
}

let current: { userId: string; db: JottrDB } | null = null

export function openDatabase(userId: string): JottrDB {
  if (current?.userId === userId) return current.db

  current?.db.close()

  const db = new Dexie(databaseName(userId)) as JottrDB
  db.version(1).stores({
    pages: 'id, parentId, dirty, updatedAt, deletedAt, isFavorite, [deletedAt+parentId]',
    docStates: 'pageId, dirty',
    docUpdates: '++seq, pageId',
    purges: 'id',
    meta: 'key',
  })

  current = { userId, db }
  return db
}

/** The open database, or null before sign-in. UI reads go through this so a
 *  signed-out render never throws. */
export function activeDatabase(): JottrDB | null {
  return current?.db ?? null
}

export function activeUserId(): string | null {
  return current?.userId ?? null
}

export function closeDatabase() {
  current?.db.close()
  current = null
}

/** Used when signing out: the notes are cloud-backed, and leaving them in
 *  IndexedDB on a device someone else may use is not a tradeoff worth making. */
export async function eraseDatabase(userId: string) {
  if (current?.userId === userId) {
    current.db.close()
    current = null
  }
  await Dexie.delete(databaseName(userId))
}

export async function readMeta<T>(db: JottrDB, key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function writeMeta(db: JottrDB, key: string, value: unknown) {
  await db.meta.put({ key, value })
}
