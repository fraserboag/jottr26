import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installBrowserGlobals } from './harness'
import type { PageRow } from '@/lib/db/schema'

installBrowserGlobals()

const { openDatabase, closeDatabase } = await import('@/lib/db/dexie')
const { createPage, deleteForever, emptyTrash, liveChildren, movePage, restorePage, trashPage } = await import(
  '@/lib/db/pages'
)
const { buildTree } = await import('@/lib/db/hooks')
const { releaseAll, whenPersisted } = await import('@/lib/db/ydoc')

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
