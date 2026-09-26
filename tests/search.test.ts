import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { installBrowserGlobals } from './harness'
import type { PageRow } from '@/lib/db/schema'

installBrowserGlobals()

const { searchPages } = await import('@/lib/db/search')
const { openDatabase, closeDatabase } = await import('@/lib/db/dexie')
const { createPage, deleteForever, refreshDerived } = await import('@/lib/db/pages')
const { moveSearchTexts, readSearchTexts } = await import('@/lib/db/searchText')
const { openDoc, releaseAll, whenPersisted, DOC_FIELD } = await import('@/lib/db/ydoc')
const Y = await import('yjs')

const texts = new Map<string, string>()

function page(id: string, title: string, searchText = '', updatedAt = 0): PageRow {
  texts.set(id, searchText)
  return {
    id,
    title,
    parentId: '',
    sortKey: id,
    deletedAt: 0,
    createdAt: 0,
    updatedAt,
    serverUpdatedAt: 0,
    dirty: 0,
    origin: 'local',
  }
}

const pages = [
  page('a', 'Meeting notes', 'agenda for the quarter', 3),
  page('b', 'Weekly meeting', '', 2),
  page('c', 'Groceries', 'milk, bread, meeting snacks', 1),
  page('d', 'Holidays', 'nothing to do with it', 4),
]

/** The picker in the link field reads this, so the ordering it produces is
 *  what the picker shows. */
describe('searchPages', () => {
  it('ranks a title that starts with the query above one that merely contains it, and body matches last', () => {
    const ids = searchPages(pages, 'meeting', texts).map((hit) => hit.page.id)
    assert.deepEqual(ids, ['a', 'b', 'c'])
  })

  it('leaves out pages that do not match at all', () => {
    assert.deepEqual(
      searchPages(pages, 'meeting', texts).map((hit) => hit.page.id),
      ['a', 'b', 'c'],
    )
    assert.deepEqual(searchPages(pages, 'aubergine', texts), [])
  })

  it('offers the most recently edited pages before anything is typed', () => {
    const ids = searchPages(pages, '  ', texts).map((hit) => hit.page.id)
    assert.deepEqual(ids, ['d', 'a', 'b', 'c'])
  })

  it('counts typing in a page as editing it, when ranking equal matches', () => {
    const typedIn = { ...page('e', 'Meeting minutes', '', 1), editedAt: 10 }
    const ids = searchPages([...pages, typedIn], 'meeting', texts).map((hit) => hit.page.id)
    assert.deepEqual(ids, ['e', 'a', 'b', 'c'])
  })

  it('quotes the surrounding text for a body match, so you can tell pages apart', () => {
    const hit = searchPages(pages, 'snacks', texts)[0]
    assert.equal(hit.page.id, 'c')
    assert.match(hit.snippet ?? '', /snacks/)
    // A title match needs no explaining.
    assert.equal(searchPages(pages, 'Groceries', texts)[0].snippet, null)
  })
})

describe('page text for search', () => {
  after(() => {
    releaseAll()
    closeDatabase()
  })

  it('moves text off page rows an older build wrote, once, keeping any newer copy', async () => {
    const db = openDatabase('search-move')
    const old = await createPage({ title: 'Old' })
    const newer = await createPage({ title: 'Newer' })
    await db.pages.update(old, { searchText: 'written by the old build' })
    await db.pages.update(newer, { searchText: 'stale' })
    await db.meta.put({ key: `search:${newer}`, value: 'fresh' })

    await moveSearchTexts(db)
    const read = await readSearchTexts(db)
    assert.equal(read.get(old), 'written by the old build')
    assert.equal(read.get(newer), 'fresh')
    for (const row of await db.pages.toArray()) assert.equal('searchText' in row, false)

    // Once only: a text an old tab puts back on a row later is left there.
    await db.pages.update(old, { searchText: 'again' })
    await moveSearchTexts(db)
    assert.equal((await db.pages.get(old))?.searchText, 'again')
    assert.equal((await readSearchTexts(db)).get(old), 'written by the old build')
  })

  it('keeps the text out of the page row, and drops it with the page', async () => {
    const db = openDatabase('search-write')
    const id = await createPage({ title: 'Plans' })
    const handle = await openDoc(id)
    const paragraph = handle.doc.getXmlFragment(DOC_FIELD).get(1) as InstanceType<typeof Y.XmlElement>
    paragraph.insert(0, [new Y.XmlText('book the ferry')])
    await whenPersisted()
    await refreshDerived(id)

    assert.match((await readSearchTexts(db)).get(id) ?? '', /book the ferry/)
    assert.equal((await db.pages.get(id))?.searchText, undefined)

    await deleteForever(id)
    assert.equal((await readSearchTexts(db)).has(id), false)
  })
})
