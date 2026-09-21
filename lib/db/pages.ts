import { generateKeyBetween } from 'fractional-indexing'
import * as Y from 'yjs'
import { activeDatabase } from './dexie'
import type { PageRow } from './schema'
import { DOC_FIELD, openDoc, readPlainText, readTitle } from './ydoc'
import { newId } from '@/lib/util/id'

function db() {
  const database = activeDatabase()
  if (!database) throw new Error('No open workspace')
  return database
}

/** Every local write goes through here: it stamps the edit time and flags the
 *  row for the sync engine in one place, so no mutation can forget to. */
async function touch(id: string, patch: Partial<PageRow>) {
  await db().pages.update(id, { ...patch, updatedAt: Date.now(), dirty: 1 })
}

export async function siblingsOf(parentId: string): Promise<PageRow[]> {
  const rows = await db().pages.where('parentId').equals(parentId).toArray()
  return rows.filter((p) => !p.deletedAt).sort(bySortKey)
}

export const bySortKey = (a: PageRow, b: PageRow) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1

export async function createPage(options: { parentId?: string; title?: string } = {}) {
  const parentId = options.parentId ?? ''
  const siblings = await siblingsOf(parentId)
  const last = siblings.at(-1)
  const now = Date.now()
  const id = newId()

  const page: PageRow = {
    id,
    title: options.title ?? '',
    parentId,
    sortKey: generateKeyBetween(last?.sortKey ?? null, null),
    deletedAt: 0,
    createdAt: now,
    updatedAt: now,
    serverUpdatedAt: 0,
    dirty: 1,
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
    updateCount: 0,
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

  return id
}

/** Mirrors the document back onto the row the sidebar and search read. The
 *  title counts as a change worth syncing; the search text does not, so it is
 *  written without flagging the row. */
export async function refreshDerived(pageId: string) {
  const handle = await openDoc(pageId)
  const page = await db().pages.get(pageId)
  if (!page) return

  const title = readTitle(handle.doc)
  if (page.title !== title) await touch(pageId, { title })

  const searchText = readPlainText(handle.doc)
  if (page.searchText !== searchText) await db().pages.update(pageId, { searchText })
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
  const ids = [pageId, ...(await descendantsOf(pageId))]
  const now = Date.now()
  for (const id of ids) await touch(id, { deletedAt: now })
}

export async function restorePage(pageId: string) {
  const page = await db().pages.get(pageId)
  if (!page) return

  // Restoring into a trashed parent would hide the page again; lift it to the
  // root instead, which is the only outcome the user can actually see.
  const parent = page.parentId ? await db().pages.get(page.parentId) : null
  const parentId = parent && !parent.deletedAt ? page.parentId : ''

  const ids = [pageId, ...(await descendantsOf(pageId))]
  for (const id of ids) await touch(id, { deletedAt: 0 })
  if (parentId !== page.parentId) await touch(pageId, { parentId })
}

export async function deleteForever(pageId: string) {
  const ids = [pageId, ...(await descendantsOf(pageId))]
  const database = db()
  await database.transaction(
    'rw',
    [database.pages, database.docStates, database.docUpdates, database.purges],
    async () => {
      for (const id of ids) {
        await database.pages.delete(id)
        await database.docStates.delete(id)
        await database.docUpdates.where('pageId').equals(id).delete()
        await database.purges.put({ id, queuedAt: Date.now() })
      }
    },
  )
}

export async function emptyTrash() {
  const trashed = await db().pages.where('deletedAt').above(0).primaryKeys()
  for (const id of trashed as string[]) await deleteForever(id)
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
