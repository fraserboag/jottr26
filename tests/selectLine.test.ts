import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { BodySelection, selectBody, selectLine } from '@/components/editor/extensions/selectLine'
import { pageSchema as schema } from './editor'

function page(...lines: string[]) {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Notes')),
    ...lines.map((text) =>
      text === '---' ? schema.node('horizontalRule') : schema.node('paragraph', null, text ? [schema.text(text)] : []),
    ),
  ])
  return EditorState.create({ doc, schema })
}

function select(state: EditorState, anchor: number, head = anchor) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)))
}

/** Mod-A as the editor runs it: the line, or failing that the body. */
function modA(state: EditorState) {
  let next = state
  const dispatch = (tr: Transaction) => {
    next = state.apply(tr)
  }
  const line = selectLine(state, dispatch)
  const applied = line || selectBody(state, dispatch)
  return { state: next, applied, line }
}

function selected(state: EditorState) {
  return state.doc.textBetween(state.selection.from, state.selection.to, '\n')
}

// Title 'Notes' spans 0–7; 'first line' starts at 8, 'second' at 20.
describe('Mod-A', () => {
  it('selects the line the caret is on', () => {
    const { state, applied } = modA(select(page('first line', 'second'), 12))
    assert.equal(applied, true)
    assert.equal(selected(state), 'first line')
  })

  it('selects the body once that line is selected, leaving out the title', () => {
    const once = modA(select(page('first line', 'second'), 12)).state
    const twice = modA(once)
    assert.equal(twice.line, false)
    assert.ok(twice.state.selection instanceof BodySelection)
    assert.equal(selected(twice.state), 'first line\nsecond')
  })

  it('stays on the body when pressed again', () => {
    const body = modA(modA(select(page('first line', 'second'), 12)).state).state
    const again = modA(body)
    assert.equal(again.applied, true)
    assert.equal(again.state, body)
  })

  it('widens a partial selection within the line to all of it', () => {
    const { state, applied } = modA(select(page('first line', 'second'), 10, 13))
    assert.equal(applied, true)
    assert.equal(selected(state), 'first line')
  })

  it('selects just the title when the caret is in it', () => {
    const { state } = modA(select(page('first line'), 3))
    assert.equal(selected(state), 'Notes')
  })

  it('keeps to the title when pressed again there', () => {
    const once = modA(select(page('first line'), 3)).state
    const twice = modA(once)
    assert.equal(twice.applied, true)
    assert.equal(selected(twice.state), 'Notes')
  })

  it('goes straight to the body from an empty line', () => {
    const { state } = modA(select(page('first line', ''), 20))
    assert.ok(state.selection instanceof BodySelection)
  })

  it('goes straight to the body from a selection across lines', () => {
    const { state } = modA(select(page('first line', 'second'), 10, 22))
    assert.equal(selected(state), 'first line\nsecond')
  })

  it('takes in a divider at either end of the body', () => {
    const start = page('---', 'middle', '---')
    const { state } = modA(select(start, 9, 15))
    assert.equal(state.selection.from, state.doc.firstChild!.nodeSize)
    assert.equal(state.selection.to, state.doc.content.size)
  })

  it('copies the body without the title', () => {
    const { state } = modA(select(page('first line', 'second'), 10, 22))
    const copied = state.selection.content().content
    assert.deepEqual(
      Array.from({ length: copied.childCount }, (_, i) => copied.child(i).type.name),
      ['paragraph', 'paragraph'],
    )
  })

  it('clears to one empty line, caret on it, the title untouched', () => {
    const { state } = modA(select(page('---', 'first line', 'second'), 10, 22))
    const cleared = state.apply(state.tr.deleteSelection())
    assert.equal(cleared.doc.child(0).textContent, 'Notes')
    assert.equal(cleared.doc.childCount, 2)
    assert.equal(cleared.doc.child(1).type.name, 'paragraph')
    assert.equal(cleared.doc.child(1).content.size, 0)
    assert.equal(cleared.selection.from, 8)
  })

  it('types over the body, the title untouched', () => {
    const { state } = modA(select(page('first line', 'second'), 10, 22))
    const typed = state.apply(state.tr.insertText('x'))
    assert.equal(typed.doc.child(0).textContent, 'Notes')
    assert.equal(typed.doc.childCount, 2)
    assert.equal(typed.doc.child(1).textContent, 'x')
  })
})
