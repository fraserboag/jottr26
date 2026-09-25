import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { selectLine } from '@/components/editor/extensions/selectLine'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false }),
])

function page(...lines: string[]) {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Notes')),
    ...lines.map((text) => schema.node('paragraph', null, text ? [schema.text(text)] : [])),
  ])
  return EditorState.create({ doc, schema })
}

function select(state: EditorState, anchor: number, head = anchor) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)))
}

/** Mod-A as the editor runs it: this command, or select-all if it declines. */
function modA(state: EditorState) {
  let next = state
  const applied = selectLine(state, (tr) => {
    next = state.apply(tr)
  })
  return { state: next, applied }
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

  it('declines once that line is selected, leaving the whole page to select-all', () => {
    const once = modA(select(page('first line', 'second'), 12)).state
    assert.equal(modA(once).applied, false)
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

  it('goes straight to the whole page from an empty line', () => {
    assert.equal(modA(select(page('first line', ''), 20)).applied, false)
  })

  it('goes straight to the whole page from a selection across lines', () => {
    assert.equal(modA(select(page('first line', 'second'), 10, 22)).applied, false)
  })
})
