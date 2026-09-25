import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { Callout } from '@/components/editor/extensions/callout'
import { FinanceTable } from '@/components/editor/extensions/finance'
import { JottrDocument, Title, leaveTitle, openBodyLine } from '@/components/editor/extensions/title'

/** The editor's real extension list, minus the ones that need a browser. */
const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false }),
  Callout,
  TableKit.configure({ table: false }),
  FinanceTable.configure({ renderWrapper: true }),
])

function paragraph(text?: string) {
  return schema.node('paragraph', null, text ? [schema.text(text)] : [])
}

/** A page whose caret sits at the end of the title — where someone who has
 *  just finished naming the page is. */
function page(...body: Node[]) {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Notes')),
    ...body,
  ])
  const state = EditorState.create({ doc, schema })
  return caretAt(state, doc.child(0).nodeSize - 1)
}

/** The same document with the caret parked at an exact position. */
function caretAt(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** The two keys the title binds, as the extension binds them. */
const enter = openBodyLine('title')
const tab = leaveTitle('title')

/** Run a ProseMirror command the way the editor's chain does. */
function run(state: EditorState, command: Command) {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { state: next, applied }
}

/** The names of the document's top-level blocks, title included. */
function outline(state: EditorState) {
  return state.doc.children.map((node) => node.type.name)
}

/** Where the caret landed: the block it is in, and whether that block is empty. */
function caret(state: EditorState) {
  const { $from } = state.selection
  return {
    depth: $from.depth,
    block: $from.parent.type.name,
    empty: $from.parent.content.size === 0,
    index: $from.index(0),
  }
}

describe('leaving the title', () => {
  it('opens an empty line at the top of the body and puts the caret in it', () => {
    const { state, applied } = run(page(paragraph('Body')), enter)
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'paragraph', 'paragraph'])
    assert.equal(state.doc.child(1).content.size, 0, 'the new line is empty')
    assert.equal(state.doc.child(2).textContent, 'Body', 'what was there is pushed down whole')
    assert.deepEqual(caret(state), { depth: 1, block: 'paragraph', empty: true, index: 1 })
  })

  it('leaves the name itself where it is', () => {
    const { state } = run(page(paragraph('Body')), enter)
    assert.equal(state.doc.child(0).textContent, 'Notes')
    assert.equal(state.doc.child(0).type.name, 'title')
  })

  it('uses the blank line a fresh page already has rather than adding a second', () => {
    // A page typed from new is a title and one empty paragraph: Enter should
    // land in that line, not leave a spare blank row under the caret.
    const { state, applied } = run(page(paragraph()), enter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph'])
    assert.deepEqual(caret(state), { depth: 1, block: 'paragraph', empty: true, index: 1 })
  })

  it('opens a line above a body that starts with something other than a paragraph', () => {
    const start = page(schema.node('blockquote', null, [paragraph('Quoted')]))
    const { state, applied } = run(start, enter)
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'paragraph', 'blockquote'])
    assert.deepEqual(caret(state), { depth: 1, block: 'paragraph', empty: true, index: 1 })
  })

  it('does the same wherever the caret is in the title, which cannot be split', () => {
    const start = caretAt(page(paragraph('Body')), 3)
    const { state, applied } = run(start, enter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph', 'paragraph'])
    assert.equal(state.doc.child(0).textContent, 'Notes', 'the name is not cut in two')
    assert.deepEqual(caret(state), { depth: 1, block: 'paragraph', empty: true, index: 1 })
  })

  it('leaves Enter alone when text in the title is selected', () => {
    const start = page(paragraph('Body'))
    const selected = start.apply(
      start.tr.setSelection(TextSelection.create(start.doc, 1, start.doc.child(0).nodeSize - 1)),
    )
    assert.equal(run(selected, enter).applied, false)
  })

  it('leaves Enter alone in the body, where it means new paragraph', () => {
    const start = page(paragraph('Body'))
    const inBody = caretAt(start, start.doc.content.size - 1)
    assert.equal(run(inBody, enter).applied, false)
  })

  it('moves into the body on Tab without writing a line', () => {
    // Tab is still what it was: a step between fields, not a way to add one.
    const { state, applied } = run(page(paragraph('Body')), tab)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph'])
    assert.deepEqual(caret(state), { depth: 1, block: 'paragraph', empty: false, index: 1 })
  })

  it('leaves Tab alone in the body', () => {
    const start = page(paragraph('Body'))
    assert.equal(run(caretAt(start, start.doc.content.size - 1), tab).applied, false)
  })
})
