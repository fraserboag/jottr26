import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { after, describe, it } from 'node:test'
import { installBrowserGlobals } from './harness'
import type { PageRow } from '@/lib/db/schema'

installBrowserGlobals()

const { openDatabase, closeDatabase } = await import('@/lib/db/dexie')
const { createPage, deleteForever, emptyTrash, liveChildren, movePage, restorePage, touch, trashPage } = await import(
  '@/lib/db/pages'
)
const { buildTree, reuseRows } = await import('@/lib/db/hooks')
const { DOC_FIELD, openDoc, releaseAll, whenPersisted } = await import('@/lib/db/ydoc')

const row = (id: string, parentId = ''): PageRow => ({
  id,
  title: id,
  parentId,
  sortKey: id,
  isFavorite: 0,
  deletedAt: 0,
  createdAt: 0,
  updatedAt: 0,
  serverUpdatedAt: 0,
  dirty: 0,
  searchText: '',
  origin: 'local',
})

const shape = (nodes: ReturnType<typeof buildTree>): unknown =>
  nodes.map((node) => (node.children.length ? { [node.page.id]: shape(node.children) } : node.page.id))

describe('sidebar tree', () => {
  it('keeps last time\'s rows, and the list itself, when only search text and edit time moved on', () => {
    const before = [row('a'), row('b')]
    const typed = [{ ...before[0], searchText: 'hello', editedAt: 5 }, { ...before[1] }]
    assert.equal(reuseRows(before, typed), before)
  })

  it('takes a changed row, and a changed flag list, while keeping the rows around it', () => {
    const before = [row('a'), { ...row('b'), dirtyFields: ['title' as const] }]
    const renamed = [{ ...before[0], title: 'A' }, { ...before[1], dirtyFields: ['title' as const] }]
    const after = reuseRows(before, renamed)
    assert.notEqual(after, before)
    assert.equal(after[0], renamed[0])
    assert.equal(after[1], before[1], 'an equal flag list is not a change')

    const flagged = reuseRows(before, [before[0], { ...before[1], dirtyFields: ['parentId' as const] }])
    assert.notEqual(flagged[1], before[1])
  })

  it('follows pages being added, removed and reordered', () => {
    const before = [row('a'), row('b')]
    assert.deepEqual(reuseRows(before, [row('b'), row('a')]).map((page) => page.id), ['b', 'a'])
    assert.notEqual(reuseRows(before, [row('b'), row('a')]), before)
    assert.deepEqual(reuseRows(before, [row('a')]).map((page) => page.id), ['a'])
    assert.deepEqual(reuseRows(before, [...before, row('c')]).map((page) => page.id), ['a', 'b', 'c'])
  })

  it('nests pages under their parents, keeping the order they came in', () => {
    const tree = buildTree([row('a'), row('a1', 'a'), row('b'), row('a2', 'a'), row('a1x', 'a1')])
    assert.deepEqual(shape(tree), [{ a: [{ a1: ['a1x'] }, 'a2'] }, 'b'])
  })

  it('shows a page whose parent is missing at the root, rather than dropping it', () => {
    const tree = buildTree([row('a'), row('orphan', 'not-pulled-yet')])
    assert.deepEqual(shape(tree), ['a', 'orphan'])
  })

  it('shows pages that are each inside the other, rather than dropping them', () => {
    const tree = buildTree([row('a'), row('x', 'y'), row('y', 'x'), row('y1', 'y'), row('self', 'self')])
    assert.deepEqual(shape(tree), ['a', { x: [{ y: ['y1'] }] }, 'self'])
  })
})

describe('live children', () => {
  const db = openDatabase('tree')
  after(async () => {
    await whenPersisted()
    releaseAll()
    closeDatabase()
  })

  it('lists the pages under a parent in sidebar order, leaving out the trash', async () => {
    const parent = await createPage()
    const first = await createPage({ parentId: parent })
    const second = await createPage({ parentId: parent })
    const binned = await createPage({ parentId: parent })
    await trashPage(binned)
    await movePage(second, parent, 0)

    const ids = (await liveChildren(db, parent)).map((page) => page.id)
    assert.deepEqual(ids, [second, first])
  })

  it('lists the children of several parents at once', async () => {
    const a = await createPage()
    const b = await createPage()
    const underA = await createPage({ parentId: a })
    const underB = await createPage({ parentId: b })

    const ids = (await liveChildren(db, [a, b])).map((page) => page.id).sort()
    assert.deepEqual(ids, [underA, underB].sort())
  })

  it('trashes and deletes pages that are each inside the other, without looping', async () => {
    const x = await createPage()
    const y = await createPage({ parentId: x })
    await db.pages.update(x, { parentId: y })

    await trashPage(x)
    assert.ok((await db.pages.get(y))!.deletedAt > 0)
    await restorePage(y)
    assert.equal((await db.pages.get(x))!.deletedAt, 0)
    await trashPage(y)
    await deleteForever(y)
    assert.equal(await db.pages.get(x), undefined)
  })

  it('lets go of a page\'s document when the page is deleted for good, so it writes nothing more', async () => {
    const id = await createPage()
    const handle = await openDoc(id)
    await whenPersisted()
    await trashPage(id)
    await deleteForever(id)

    // An editor still showing it for a moment, or a late pull, edits it.
    handle.doc.getXmlFragment(DOC_FIELD).insert(0, [new Y.XmlText('late')])
    await whenPersisted()
    assert.equal(await db.docUpdates.where('pageId').equals(id).count(), 0)
    assert.equal(await db.docStates.get(id), undefined)
    assert.notEqual(await openDoc(id), handle, 'opened again, it starts afresh')
  })

  it('stamps every edit of a page later than the last, even within one millisecond', async () => {
    const id = await createPage()
    const realNow = Date.now
    const frozen = realNow()
    Date.now = () => frozen
    try {
      await touch(id, { title: 'one' })
      const first = (await db.pages.get(id))!.updatedAt
      await touch(id, { isFavorite: 1 })
      assert.ok((await db.pages.get(id))!.updatedAt > first)
    } finally {
      Date.now = realNow
    }
  })

  it('leaves a live page under a trashed one when the trash is emptied', async () => {
    const parent = await createPage()
    await trashPage(parent)
    // Added by another device that hadn't seen the trashing yet.
    const added = await createPage({ parentId: parent })

    await emptyTrash()
    assert.equal(await db.pages.get(parent), undefined)
    assert.ok(await db.pages.get(added))
  })

  it('leaves a live page under a trashed one when that page is deleted for good', async () => {
    const parent = await createPage()
    const binned = await createPage({ parentId: parent })
    await trashPage(parent)
    const added = await createPage({ parentId: parent })

    await deleteForever(parent)
    assert.equal(await db.pages.get(binned), undefined)
    assert.ok(await db.pages.get(added))
  })

  it('restores a parent without the children trashed on their own before it', async () => {
    const parent = await createPage()
    const kept = await createPage({ parentId: parent })
    const binned = await createPage({ parentId: parent })
    const under = await createPage({ parentId: binned })
    await trashPage(binned)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await trashPage(parent)

    await restorePage(parent)
    assert.equal((await db.pages.get(kept))!.deletedAt, 0)
    assert.ok((await db.pages.get(binned))!.deletedAt > 0)
    assert.ok((await db.pages.get(under))!.deletedAt > 0)
  })

  it('drops a page between two siblings that share a sort key', async () => {
    const parent = await createPage()
    const a = await createPage({ parentId: parent })
    const b = await createPage({ parentId: parent })
    const c = await createPage({ parentId: parent })
    const moved = await createPage()
    // Two devices each added a page offline and picked the same key.
    await db.pages.update(b, { sortKey: (await db.pages.get(a))!.sortKey })

    const [first, ...rest] = (await liveChildren(db, parent)).map((page) => page.id)
    await movePage(moved, parent, 1)
    const ids = (await liveChildren(db, parent)).map((page) => page.id)
    assert.deepEqual(ids, [first, moved, ...rest])
    assert.deepEqual(rest.at(-1), c)
    const keys = (await liveChildren(db, parent)).map((page) => page.sortKey)
    assert.equal(new Set(keys).size, keys.length)
  })

  it('restores a page to the end of the root when its parent is in the trash', async () => {
    const parent = await createPage()
    const child = await createPage({ parentId: parent })
    await trashPage(child)
    await trashPage(parent)

    await restorePage(child)
    const roots = await liveChildren(db, '')
    assert.equal(roots.at(-1)!.id, child)
    assert.equal(roots.filter((page) => page.sortKey === roots.at(-1)!.sortKey).length, 1)
  })
})
