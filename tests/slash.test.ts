import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterSlashItems, slashAllowed, slashItems } from '@/components/editor/extensions/slash'
import { headlessEditor, inside, page, paragraph } from './editor'

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

  it("draws an accordion's heading as a Title, which can't become a Title block", () => {
    const box = {
      type: 'accordion',
      content: [
        { type: 'accordionTitle', content: [{ type: 'text', text: 'Head /ti' }] },
        { type: 'accordionBody', content: [{ type: 'paragraph' }] },
      ],
    }
    const title = { type: 'title', content: [{ type: 'text', text: 'N' }] }
    const instance = headlessEditor({ type: 'doc', content: [title, box] }, 13)
    slashItems.find((item) => item.id === 'title')!.run(instance, { from: 10, to: 13 })
    const heading = instance.state.doc.child(1).child(0)
    assert.equal(heading.textContent, 'Head ')
    assert.equal(heading.attrs.title, true)
  })

  it('opens in the body but not in the page title', () => {
    const state = page(paragraph('Plan /code'))
    const title = inside(state, 'title', 1)
    const body = inside(state, 'paragraph', 5)
    assert.equal(slashAllowed(state, { from: title, to: title + 1 }), false)
    assert.equal(slashAllowed(state, { from: body, to: body + 5 }), true)
  })
})
