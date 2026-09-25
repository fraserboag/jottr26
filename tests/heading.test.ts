import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor, getExtensionField, getSchema, type InputRule, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { AccordionKit } from '@/components/editor/extensions/accordion'
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

describe('title toggle', () => {
  /** A headless editor over the given body, with the caret at the start of
   *  the first text in it. */
  function editor(body: JSONContent[]) {
    const instance = new Editor({
      element: null,
      extensions: [StarterKit.configure({ undoRedo: false, heading: false }), Heading, ...AccordionKit],
      content: { type: 'doc', content: body },
    })
    instance.commands.setTextSelection(3)
    return instance
  }
  const text = (value: string) => [{ type: 'text', text: value }]
  const titleOf = (instance: Editor) => instance.state.doc.firstChild!.firstChild!.attrs.title

  it('turns a line into a Title and back', () => {
    const instance = editor([{ type: 'paragraph', content: text('Plans') }])
    instance.commands.toggleTitle()
    assert.equal(instance.state.doc.firstChild!.type.name, 'heading')
    instance.commands.toggleTitle()
    assert.equal(instance.state.doc.firstChild!.type.name, 'paragraph')
  })

  it("draws an accordion's heading as a Title and back, keeping the accordion", () => {
    const instance = editor([
      {
        type: 'accordion',
        content: [
          { type: 'accordionTitle', content: text('Details') },
          { type: 'accordionBody', content: [{ type: 'paragraph' }] },
        ],
      },
    ])
    instance.commands.toggleTitle()
    assert.equal(instance.state.doc.firstChild!.type.name, 'accordion')
    assert.equal(titleOf(instance), true)
    assert.ok(instance.isActive('accordionTitle', { title: true }))
    instance.commands.toggleTitle()
    assert.equal(titleOf(instance), false)
  })

  it('keeps the Title when a Title line becomes an accordion, and when it goes back', () => {
    const instance = editor([{ type: 'heading', content: text('Details') }])
    instance.commands.toggleAccordion()
    assert.equal(instance.state.doc.firstChild!.type.name, 'accordion')
    assert.equal(titleOf(instance), true)
    instance.commands.toggleAccordion()
    assert.equal(instance.state.doc.firstChild!.type.name, 'heading')
    assert.equal(instance.state.doc.firstChild!.textContent, 'Details')
  })

  it("keeps an accordion's Title style through Yjs", () => {
    const instance = editor([
      {
        type: 'accordion',
        content: [
          { type: 'accordionTitle', attrs: { title: true }, content: text('Details') },
          { type: 'accordionBody', content: [{ type: 'paragraph' }] },
        ],
      },
    ])
    const fragment = new Y.Doc().getXmlFragment('default')
    prosemirrorToYXmlFragment(instance.state.doc, fragment)
    const back = yXmlFragmentToProseMirrorRootNode(fragment, instance.schema)
    assert.equal(back.firstChild!.firstChild!.attrs.title, true)
  })
})
