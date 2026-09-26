import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installBrowserGlobals } from './harness'
import type { PageRow } from '@/lib/db/schema'

installBrowserGlobals()

const { openDatabase, closeDatabase } = await import('@/lib/db/dexie')
const { createPage, liveChildren, movePage, trashPage } = await import('@/lib/db/pages')
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
})
