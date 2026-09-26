import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterSlashItems } from '@/components/editor/extensions/slash'

/** Each block, and the words people reach for when they want it. */
const keywords: Array<[string, string, string[]]> = [
  ['callout', 'the callout', ['callout', 'note', 'box', 'aside']],
  ['accordion', 'the accordion', ['accordion', 'toggle', 'collapse', 'fold']],
  ['subpages', 'the subpage list', ['sub', 'Subpages', 'children', 'pages']],
  ['title', 'the Title', ['title', 'heading']],
]

describe('the slash menu', () => {
  for (const [id, name, queries] of keywords) {
    it(`offers ${name} under the words people reach for`, () => {
      for (const query of queries) {
        assert.equal(
          filterSlashItems(query).some((item) => item.id === id),
          true,
          `'${query}' should find ${name}`,
        )
      }
    })
  }

  it("finds only the Title for '/title'", () => {
    assert.deepEqual(filterSlashItems('title').map((item) => item.id), ['title'])
  })

  it("finds only the subpage list for '/sub'", () => {
    assert.deepEqual(filterSlashItems('sub').map((item) => item.id), ['subpages'])
  })
})
