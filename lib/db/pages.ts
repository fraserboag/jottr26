import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import * as Y from 'yjs'
import { activeDatabase, type JottrDB } from './dexie'
import { PAGE_FIELDS, type PageField, type PageRow } from './schema'
import { DOC_FIELD, notifyLocalEdit, openDoc, readPlainText, readTitle } from './ydoc'
import { newId } from '@/lib/util/id'

function db() {
  const database = activeDatabase()
  if (!database) throw new Error('No open workspace')
  return database
}

/** Every local write goes through here: it stamps the edit time and flags the
 *  row for the sync engine in one place, so no mutation can forget to. The
 *  engine passes the database it was started against. Several ids are written
 *  in one transaction, and announced as one edit. */
export async function touch(
  ids: string | string[],
  patch: Partial<Pick<PageRow, PageField>>,
  database: JottrDB = db(),
) {
  const fields = Object.keys(patch) as PageField[]
  await database
    .pages.where('id')
    .anyOf(typeof ids === 'string' ? [ids] : ids)
    .modify((page) => {
      Object.assign(page, patch)
      page.updatedAt = Date.now()
      // A clean row starts a fresh list; a row already waiting to be pushed
      // adds to its own. One with no list is dirty in every field already.
      const already = page.dirty ? page.dirtyFields : []
      page.dirtyFields = already && [...new Set([...already, ...fields])]
      page.dirty = 1
    })
  // A title follows typing and waits with it; anything else is a deliberate
  // act on the page that should reach the other devices at once.
  notifyLocalEdit(fields.every((field) => field === 'title') ? 'text' : 'structure')
}

export function siblingsOf(parentId: string): Promise<PageRow[]> {
  return liveChildren(db(), parentId)
}

/** The pages directly under these parents that are not in the trash, in
 *  sidebar order. `''` is the root. */
export async function liveChildren(database: JottrDB, parentIds: string | string[]) {
  const keys = (typeof parentIds === 'string' ? [parentIds] : parentIds).map((id) => [0, id])
  const rows = await database.pages.where('[deletedAt+parentId]').anyOf(keys).toArray()
  return rows.sort(bySortKey)
}

export const bySortKey = (a: PageRow, b: PageRow) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1

/** `id` is for callers that have to point at the page before it exists, like a
 *  link written into the open document before this write has finished. */
export async function createPage(options: { id?: string; parentId?: string; title?: string } = {}) {
  const parentId = options.parentId ?? ''
  const siblings = await siblingsOf(parentId)
  const last = siblings.at(-1)
  const now = Date.now()
  const id = options.id ?? newId()

  const page: PageRow = {
    id,
    title: options.title ?? '',
    parentId,
    sortKey: generateKeyBetween(last?.sortKey ?? null, null),
    isFavorite: 0,
    deletedAt: 0,
    createdAt: now,
    updatedAt: now,
    serverUpdatedAt: 0,
    dirty: 1,
    dirtyFields: [...PAGE_FIELDS],
    searchText: '',
    // This device owns the document's initial shape. A page that arrived from
    // the server is marked 'remote' and waits for its content instead.
    origin: 'local',
  }

  await db().pages.add(page)
  await db().docStates.put({
    pageId: id,
    snapshot: new Uint8Array(),
    version: 0,
    dirty: 1,
    edits: 0,
  })

  const handle = await openDoc(id, { seed: true })
  if (options.title) {
    const titleNode = handle.doc.getXmlFragment(DOC_FIELD).get(0)
    if (titleNode instanceof Y.XmlElement) {
      handle.doc.transact(() => {
        titleNode.insert(0, [new Y.XmlText(options.title!)])
      })
    }
  }

  notifyLocalEdit('structure')
  return id
}

/** Mirrors the document back onto the row the sidebar and search read. The
 *  title counts as a change worth syncing; the search text and edit time do
 *  not, so they are written without flagging the row. */
export async function refreshDerived(pageId: string) {
  const handle = await openDoc(pageId)
  const page = await db().pages.get(pageId)
  if (!page) return

  const title = readTitle(handle.doc)
  if (page.title !== title) await touch(pageId, { title })

  const patch: Partial<PageRow> = {}
  const searchText = readPlainText(handle.doc)
  if (page.searchText !== searchText) patch.searchText = searchText
  if (handle.editedAt > (page.editedAt ?? 0)) patch.editedAt = handle.editedAt
  if (Object.keys(patch).length) await db().pages.update(pageId, patch)
}

export async function toggleFavorite(pageId: string) {
  const page = await db().pages.get(pageId)
  if (!page) return
  await touch(pageId, { isFavorite: page.isFavorite ? 0 : 1 })
}

export async function movePage(pageId: string, parentId: string, index: number) {
  if (pageId === parentId) return
  if (await isDescendant(parentId, pageId)) return

  const siblings = (await siblingsOf(parentId)).filter((p) => p.id !== pageId)
  const before = siblings[index - 1]?.sortKey ?? null
  const after = siblings[index]?.sortKey ?? null
  if (before === null || before !== after) {
    await touch(pageId, { parentId, sortKey: generateKeyBetween(before, after) })
    return
  }

  // Two devices can each pick the same key offline, and there is no key
  // between equal ones. Give the run that shares it fresh keys, with the page
  // at its place among them.
  let start = index - 1
  while (start > 0 && siblings[start - 1].sortKey === after) start -= 1
  let end = index
  while (end < siblings.length && siblings[end].sortKey === after) end += 1
  const run = [...siblings.slice(start, index).map((p) => p.id), pageId, ...siblings.slice(index, end).map((p) => p.id)]
  const keys = generateNKeysBetween(siblings[start - 1]?.sortKey ?? null, siblings[end]?.sortKey ?? null, run.length)
  for (const [i, id] of run.entries()) {
    await touch(id, id === pageId ? { parentId, sortKey: keys[i] } : { sortKey: keys[i] })
  }
}

async function isDescendant(candidate: string, ancestor: string): Promise<boolean> {
  // Visited rather than capped at a depth, so a deep tree cannot be looped
  // and a ring left by two offline moves still ends the walk.
  const seen = new Set<string>()
  for (let current = candidate; current && !seen.has(current); ) {
    if (current === ancestor) return true
    seen.add(current)
    const page = await db().pages.get(current)
    if (!page) return false
    current = page.parentId
  }
  return false
}

/** The pages under this one, reached only through children `follow` accepts.
 *  A merge of two offline moves can leave pages inside each other, so each
 *  page is visited once rather than looping forever. */
async function descendantsOf(pageId: string, follow: (page: PageRow) => boolean): Promise<string[]> {
  const visited = new Set([pageId])
  const out: string[] = []
  const queue = [pageId]
  while (queue.length) {
    const id = queue.shift()!
    for (const child of await db().pages.where('parentId').equals(id).toArray()) {
      if (visited.has(child.id) || !follow(child)) continue
      visited.add(child.id)
      out.push(child.id)
      queue.push(child.id)
    }
  }
  return out
}

/** Soft delete. Live children follow their parent into the trash so the tree
 *  stays coherent, and everything is restorable. A child already in the trash
 *  keeps its own deletion, so restoring the parent leaves it there. */
export async function trashPage(pageId: string) {
  const live = await descendantsOf(pageId, (page) => page.deletedAt === 0)
  await touch([pageId, ...live], { deletedAt: Date.now() })
}

export async function restorePage(pageId: string) {
  const page = await db().pages.get(pageId)
  if (!page) return

  // Restoring into a trashed parent would hide the page again; lift it to the
  // root instead, which is the only outcome the user can actually see.
  const parent = page.parentId ? await db().pages.get(page.parentId) : null
  const parentId = parent && !parent.deletedAt ? page.parentId : ''

  // Only the pages trashed along with this one, which share its timestamp.
  const together = await descendantsOf(pageId, (child) => child.deletedAt === page.deletedAt)
  await touch([pageId, ...together], { deletedAt: 0 })
  // Its old key belongs to its old siblings, and may equal a root page's.
  if (parentId !== page.parentId) {
    const last = (await siblingsOf(parentId)).at(-1)
    await touch(pageId, { parentId, sortKey: generateKeyBetween(last?.sortKey ?? null, null) })
  }
}

/** Takes the trashed pages under this one with it. A live page under it, such
 *  as one another device added after the trashing, stays. */
export async function deleteForever(pageId: string) {
  await purge([pageId, ...(await descendantsOf(pageId, (page) => page.deletedAt > 0))])
}

/** Forgets the pages here and queues them for the server, in one transaction,
 *  so a purge made offline is held until it can be sent. */
async function purge(ids: string[]) {
  const database = db()
  const queuedAt = Date.now()
  await database.transaction(
    'rw',
    [database.pages, database.docStates, database.docUpdates, database.purges],
    async () => {
      await forgetPages(database, ids)
      await database.purges.bulkPut(ids.map((id) => ({ id, queuedAt })))
    },
  )
  notifyLocalEdit('structure')
}

/** Drops every trace of these pages from this device, without queueing
 *  anything for the server. Used both here and when a pull learns that another
 *  device deleted them for good. */
export async function forgetPages(database: JottrDB, ids: string[]) {
  if (ids.length === 0) return
  await database.transaction('rw', [database.pages, database.docStates, database.docUpdates], async () => {
    await database.pages.bulkDelete(ids)
    await database.docStates.bulkDelete(ids)
    await database.docUpdates.where('pageId').anyOf(ids).delete()
  })
}

export async function emptyTrash() {
  // Only what is in the trash, as the confirm counted it. A live page under a
  // trashed one stays, as deleteForever leaves it.
  const trashed = (await db().pages.where('deletedAt').above(0).primaryKeys()) as string[]
  if (trashed.length === 0) return
  await purge(trashed)
}

export type DropZone = 'before' | 'after' | 'inside'

/** Reordering from the sidebar. Sort keys are fractional strings, so dropping a
 *  page between two others rewrites one row rather than renumbering a list. */
export async function dropRelative(dragId: string, targetId: string, zone: DropZone) {
  if (dragId === targetId) return
  const target = await db().pages.get(targetId)
  if (!target) return

  if (zone === 'inside') {
    const children = await siblingsOf(targetId)
    await movePage(dragId, targetId, children.length)
    return
  }

  const siblings = (await siblingsOf(target.parentId)).filter((page) => page.id !== dragId)
  const index = siblings.findIndex((page) => page.id === targetId)
  if (index < 0) return
  await movePage(dragId, target.parentId, zone === 'after' ? index + 1 : index)
}
