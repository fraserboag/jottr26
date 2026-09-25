import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getExtensionField, getSchema, type InputRule } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Heading } from '@/components/editor/extensions/heading'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { filterSlashItems } from '@/components/editor/extensions/slash'

const schema = getSchema([JottrDocument, Title, StarterKit.configure({ document: false, undoRedo: false, heading: false }), Heading])
const heading = schema.nodes.heading

/** The markdown shortcut's pattern, as the editor would install it. */
const [rule] = getExtensionField<() => InputRule[]>(Heading, 'addInputRules', {
  name: 'heading',
  options: {},
  storage: {},
  type: heading,
})()
const shortcut = (typed: string) => (rule.find as RegExp).test(typed)

describe('title block', () => {
  it('has no level, so there is only the one size', () => {
    assert.deepEqual(Object.keys(heading.spec.attrs ?? {}), [])
  })

  it("comes from any of '#' to '######' and a space at the start of a line", () => {
    for (const hashes of ['#', '##', '###', '####', '#####', '######']) assert.ok(shortcut(`${hashes} `), hashes)
  })

  it('leaves seven hashes, a hash without its space, or a hash mid-line alone', () => {
    for (const typed of ['####### ', '#', 'a # ']) assert.ok(!shortcut(typed), typed)
  })

  it('is in the slash menu as Title', () => {
    assert.deepEqual(filterSlashItems('title').map((item) => item.id), ['title'])
    assert.ok(filterSlashItems('heading').some((item) => item.id === 'title'))
  })

  it('reads a pasted h1 to h6 as itself, but leaves the page title its own h1', () => {
    const tags = heading.spec.parseDOM?.map((parse) => parse.tag)
    assert.deepEqual(tags, ['h1:not(.jottr-title)', 'h2', 'h3', 'h4', 'h5', 'h6'])
    const [tag] = heading.spec.toDOM?.(heading.create()) as readonly [string]
    assert.equal(tag, 'h2')
  })
})
