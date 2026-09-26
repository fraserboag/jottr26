import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JSONContent } from '@tiptap/core'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { GapCursor } from '@tiptap/pm/gapcursor'
import { CellSelection } from '@tiptap/pm/tables'
import { deleteLine } from '@/components/editor/extensions/deleteLine'
import { BodySelection } from '@/components/editor/extensions/selectLine'
import { cellAt, inside, pageSchema as schema, run } from './editor'

const p = (text?: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const items = (...lines: Array<string | JSONContent>): JSONContent => ({
  type: 'bulletList',
  content: lines.map((line) => ({
    type: 'listItem',
    content: typeof line === 'string' ? [p(line)] : [p('parent'), line],
  })),
})

/** A page titled 'Notes' holding these blocks, the caret nowhere in particular. */
function page(...body: JSONContent[]) {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'title', content: [{ type: 'text', text: 'Notes' }] }, ...body],
  })
  return EditorState.create({ doc, schema })
}

/** The caret in the first line holding `text`, `offset` characters in. */
function caretOn(state: EditorState, text: string, offset = 1) {
  let pos = -1
  state.doc.descendants((node, at) => {
    if (pos < 0 && node.isTextblock && node.textContent === text) pos = at + 1 + offset
    return pos < 0
  })
  assert.notEqual(pos, -1, `no line reading '${text}'`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** The page's lines as text, one entry per textblock, title first. */
function lines(state: EditorState) {
  const found: string[] = []
  state.doc.descendants((node) => {
    if (node.isTextblock) found.push(node.textContent)
    return !node.isTextblock
  })
  return found
}

function body(state: EditorState) {
  return state.doc.children.slice(1).map((node) => node.type.name)
}

/** The text of the line the caret is on, and how far along it. */
function caret(state: EditorState) {
  const { $head, empty } = state.selection
  assert.ok(empty && state.selection instanceof TextSelection, 'the caret is not a plain caret')
  return { line: $head.parent.textContent, offset: $head.parentOffset }
}

describe('deleting the line', () => {
  it('takes the whole line the caret is on and goes on to the next', () => {
    const { state, applied } = run(caretOn(page(p('one'), p('two'), p('three')), 'two'), deleteLine)
    assert.equal(applied, true)
    assert.deepEqual(lines(state), ['Notes', 'one', 'three'])
    assert.deepEqual(caret(state), { line: 'three', offset: 0 })
  })

  it('goes back to the end of the line above when it was the last', () => {
    const { state } = run(caretOn(page(p('one'), p('two')), 'two'), deleteLine)
    assert.deepEqual(lines(state), ['Notes', 'one'])
    assert.deepEqual(caret(state), { line: 'one', offset: 3 })
  })

  it('leaves the page one empty line rather than nothing', () => {
    const { state, applied } = run(caretOn(page(p('only')), 'only'), deleteLine)
    assert.equal(applied, true)
    assert.deepEqual(lines(state), ['Notes', ''])
    assert.deepEqual(caret(state), { line: '', offset: 0 })
  })

  it('has nothing to do on a page that is one empty line already', () => {
    const state = page(p())
    const { applied } = run(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8))), deleteLine)
    assert.equal(applied, false)
  })

  it('never deletes the title', () => {
    const { applied } = run(caretOn(page(p('one')), 'Notes'), deleteLine)
    assert.equal(applied, false)
  })

  it('never backs up into the title, selecting a divider left above instead', () => {
    const { state } = run(caretOn(page({ type: 'horizontalRule' }, p('last')), 'last'), deleteLine)
    assert.deepEqual(body(state), ['horizontalRule'])
    assert.ok(state.selection instanceof NodeSelection)
  })

  it('has nothing to take with the caret between blocks', () => {
    const state = page({ type: 'callout', content: [{ type: 'horizontalRule' }, p('after')] })
    // Just inside the callout, ahead of its divider.
    const gap = state.apply(state.tr.setSelection(new GapCursor(state.doc.resolve(8))))
    assert.equal(run(gap, deleteLine).applied, false)
  })

  it('takes every line a selection runs across', () => {
    const start = caretOn(page(p('one'), p('two'), p('three'), p('four')), 'two')
    const end = caretOn(start, 'three').selection.head
    const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, start.selection.head, end)))
    const next = run(state, deleteLine).state
    assert.deepEqual(lines(next), ['Notes', 'one', 'four'])
    assert.deepEqual(caret(next), { line: 'four', offset: 0 })
  })
})

describe('deleting a block', () => {
  it('takes a block selected whole', () => {
    const state = page(p('one'), { type: 'horizontalRule' }, p('two'))
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 12)))
    assert.equal((selected.selection as NodeSelection).node.type.name, 'horizontalRule')
    const next = run(selected, deleteLine).state
    assert.deepEqual(body(next), ['paragraph', 'paragraph'])
    assert.deepEqual(caret(next), { line: 'two', offset: 0 })
  })

  it('takes a callout with its only line', () => {
    const { state } = run(caretOn(page(p('one'), { type: 'callout', content: [p('note')] }, p('two')), 'note'), deleteLine)
    assert.deepEqual(body(state), ['paragraph', 'paragraph'])
  })

  it('takes one line out of a callout holding several', () => {
    const { state } = run(caretOn(page({ type: 'callout', content: [p('a'), p('b')] }), 'a'), deleteLine)
    assert.deepEqual(lines(state), ['Notes', 'b'])
    assert.deepEqual(body(state), ['callout'])
  })

  it('takes a list item, and the list with its last item', () => {
    const two = run(caretOn(page(items('a', 'b')), 'a'), deleteLine).state
    assert.deepEqual(lines(two), ['Notes', 'b'])
    assert.deepEqual(body(two), ['bulletList'])

    const one = run(caretOn(page(p('before'), items('a')), 'a'), deleteLine).state
    assert.deepEqual(body(one), ['paragraph'])
  })

  it('takes a list item with the items nested under it', () => {
    const { state } = run(caretOn(page(items(items('child'), 'b')), 'parent'), deleteLine)
    assert.deepEqual(lines(state), ['Notes', 'b'])
  })

  it('takes an accordion by its heading', () => {
    const accordion: JSONContent = {
      type: 'accordion',
      content: [
        { type: 'accordionTitle', content: [{ type: 'text', text: 'heading' }] },
        { type: 'accordionBody', content: [p('inside')] },
      ],
    }
    const { state } = run(caretOn(page(p('one'), accordion), 'heading'), deleteLine)
    assert.deepEqual(body(state), ['paragraph'])

    // Its body's last line is emptied: the accordion can't go without one.
    const emptied = run(caretOn(page(accordion), 'inside'), deleteLine).state
    assert.deepEqual(lines(emptied), ['Notes', 'heading', ''])
    assert.deepEqual(caret(emptied), { line: '', offset: 0 })
  })

  it('takes a subpage list by its heading', () => {
    const subpages: JSONContent = {
      type: 'subpages',
      content: [{ type: 'subpagesTitle', content: [{ type: 'text', text: 'Pages' }] }],
    }
    const { state } = run(caretOn(page(p('one'), subpages), 'Pages'), deleteLine)
    assert.deepEqual(body(state), ['paragraph'])
  })

  it('empties a table cell rather than deleting it', () => {
    const cell = (text: string): JSONContent => ({ type: 'tableCell', content: [p(text)] })
    const table: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }] }
    const { state } = run(caretOn(page(table), 'a'), deleteLine)
    assert.deepEqual(lines(state), ['Notes', '', 'b'])
    assert.equal(run(state, deleteLine).applied, false)
  })

  it('takes a table selected whole, and nothing when only some of it is', () => {
    const cell = (text: string): JSONContent => ({ type: 'tableCell', content: [p(text)] })
    const table: JSONContent = { type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }] }
    const state = page(p('one'), table, p('two'))

    const whole = state.apply(
      state.tr.setSelection(CellSelection.create(state.doc, cellAt(state, 0, 0), cellAt(state, 0, 1))),
    )
    const next = run(whole, deleteLine).state
    assert.deepEqual(body(next), ['paragraph', 'paragraph'])
    assert.deepEqual(caret(next), { line: 'two', offset: 0 })

    const two = page(p('one'), { type: 'table', content: [
      { type: 'tableRow', content: [cell('a'), cell('b')] },
      { type: 'tableRow', content: [cell('c'), cell('d')] },
    ] })
    const some = two.apply(two.tr.setSelection(CellSelection.create(two.doc, cellAt(two, 0, 0), cellAt(two, 0, 1))))
    assert.equal(run(some, deleteLine).applied, false)
  })

  it('clears the whole body when all of it is selected', () => {
    const state = page(p('one'), { type: 'horizontalRule' }, p('two'))
    const all = state.apply(state.tr.setSelection(new BodySelection(state.doc)))
    const next = run(all, deleteLine).state
    assert.deepEqual(lines(next), ['Notes', ''])
    assert.equal(inside(next, 'paragraph'), next.selection.head)
  })
})
