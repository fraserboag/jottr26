import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { searchPages } from '@/lib/db/search'
import type { PageRow } from '@/lib/db/schema'

function page(id: string, title: string, searchText = '', updatedAt = 0): PageRow {
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
    searchText,
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
    const ids = searchPages(pages, 'meeting').map((hit) => hit.page.id)
    assert.deepEqual(ids, ['a', 'b', 'c'])
  })

  it('leaves out pages that do not match at all', () => {
    assert.deepEqual(
      searchPages(pages, 'meeting').map((hit) => hit.page.id),
      ['a', 'b', 'c'],
    )
    assert.deepEqual(searchPages(pages, 'aubergine'), [])
  })

  it('offers the most recently edited pages before anything is typed', () => {
    const ids = searchPages(pages, '  ').map((hit) => hit.page.id)
    assert.deepEqual(ids, ['d', 'a', 'b', 'c'])
  })

  it('quotes the surrounding text for a body match, so you can tell pages apart', () => {
    const hit = searchPages(pages, 'snacks')[0]
    assert.equal(hit.page.id, 'c')
    assert.match(hit.snippet ?? '', /snacks/)
    // A title match needs no explaining.
    assert.equal(searchPages(pages, 'Groceries')[0].snippet, null)
  })
})
