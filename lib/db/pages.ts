import { generateKeyBetween } from 'fractional-indexing'
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

export async function siblingsOf(parentId: string): Promise<PageRow[]> {
  const rows = await db().pages.where('parentId').equals(parentId).toArray()
  return rows.filter((p) => !p.deletedAt).sort(bySortKey)
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
  await touch(pageId, { parentId, sortKey: generateKeyBetween(before, after) })
}

async function isDescendant(candidate: string, ancestor: string): Promise<boolean> {
  let current = candidate
  for (let depth = 0; current && depth < 64; depth += 1) {
    if (current === ancestor) return true
    const page = await db().pages.get(current)
    if (!page) return false
    current = page.parentId
  }
  return false
}

async function descendantsOf(pageId: string): Promise<string[]> {
  const out: string[] = []
  const queue = [pageId]
  while (queue.length) {
    const id = queue.shift()!
    const children = await db().pages.where('parentId').equals(id).primaryKeys()
    for (const child of children as string[]) {
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

/** Soft delete. Children follow their parent into the trash so the tree stays
 *  coherent, and everything is restorable. */
export async function trashPage(pageId: string) {
  await touch([pageId, ...(await descendantsOf(pageId))], { deletedAt: Date.now() })
}

export async function restorePage(pageId: string) {
  const page = await db().pages.get(pageId)
  if (!page) return

  // Restoring into a trashed parent would hide the page again; lift it to the
  // root instead, which is the only outcome the user can actually see.
  const parent = page.parentId ? await db().pages.get(page.parentId) : null
  const parentId = parent && !parent.deletedAt ? page.parentId : ''

  await touch([pageId, ...(await descendantsOf(pageId))], { deletedAt: 0 })
  if (parentId !== page.parentId) await touch(pageId, { parentId })
}

export async function deleteForever(pageId: string) {
  await purge([pageId, ...(await descendantsOf(pageId))])
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
  const trashed = (await db().pages.where('deletedAt').above(0).primaryKeys()) as string[]
  if (trashed.length === 0) return
  // Everything under a trashed page goes with it, as deleteForever takes it.
  const ids = new Set(trashed)
  for (const id of trashed) for (const child of await descendantsOf(id)) ids.add(child)
  await purge([...ids])
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
