import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSchema } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { codeEdgeStep } from '@/components/editor/extensions/codeEdges'

const schema = getSchema([StarterKit.configure({ undoRedo: false })])
const code = schema.marks.code

/** A line written as `before [code] after`, with the caret at `caret`. */
function line(before: string, inCode: string, after: string, caret: number) {
  const content: Node[] = []
  if (before) content.push(schema.text(before))
  content.push(schema.text(inCode, [code.create()]))
  if (after) content.push(schema.text(after))
  const doc = schema.node('doc', null, [schema.node('paragraph', null, content)])
  // +1 for the paragraph's opening.
  return EditorState.create({ doc, selection: TextSelection.create(doc, caret + 1) })
}

function press(state: EditorState, dir: -1 | 1) {
  let next = state
  const handled = codeEdgeStep(state, (tr) => (next = state.apply(tr)), code, dir)
  // An arrow left to the browser moves one character, as it would there.
  if (!handled) {
    const pos = Math.max(1, Math.min(state.doc.content.size - 1, state.selection.head + dir))
    next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
  }
  return next
}

function type(state: EditorState, text: string) {
  return state.apply(state.tr.insertText(text))
}

/** The paragraph's text with code in backticks. */
function show(state: EditorState) {
  let out = ''
  state.doc.firstChild!.forEach((node) => {
    out += code.isInSet(node.marks) ? `\`${node.text}\`` : node.text
  })
  return out
}

describe('Inline code edges', () => {
  it('reaches inside the start of code coming from the right', () => {
    let state = line('say ', 'hello', '', 5) // after the h
    state = press(state, -1)
    state = type(state, 'X')
    assert.equal(show(state), 'say `Xhello`')
  })

  it('stops outside the start on a second press', () => {
    let state = line('say ', 'hello', '', 5)
    state = press(press(state, -1), -1)
    state = type(state, 'X')
    assert.equal(show(state), 'say X`hello`')
  })

  it('steps inside the start from outside it with Right', () => {
    let state = line('say ', 'hello', '', 3) // before the space
    state = press(state, 1) // onto the edge, outside
    assert.equal(show(type(state, 'X')), 'say X`hello`')
    state = press(state, 1) // across it
    assert.equal(show(type(state, 'X')), 'say `Xhello`')
    state = press(state, 1) // on past the h
    assert.equal(show(type(state, 'X')), 'say `hXello`')
  })

  it('reaches inside and outside code that starts the line', () => {
    let state = line('', 'hello', '', 1)
    state = press(state, -1)
    assert.equal(show(type(state, 'X')), '`Xhello`')
    state = press(state, -1)
    assert.equal(show(type(state, 'X')), 'X`hello`')
  })

  it('leaves code that ends the line with Right, without typing a space', () => {
    let state = line('say ', 'hello', '', 9)
    assert.equal(show(type(state, 'X')), 'say `helloX`')
    state = press(state, 1)
    assert.equal(show(type(state, 'X')), 'say `hello`X')
  })

  it('stops outside the end first coming from the right', () => {
    let state = line('', 'hello', ' there', 6) // after the space
    state = press(state, -1)
    assert.equal(show(type(state, 'X')), '`hello`X there')
    state = press(state, -1)
    assert.equal(show(type(state, 'X')), '`helloX` there')
    state = press(state, -1)
    assert.equal(show(type(state, 'X')), '`hellXo` there')
  })

  it('leaves arrows alone away from code', () => {
    const state = line('say ', 'hello', ' there', 1)
    assert.equal(codeEdgeStep(state, () => {}, code, 1), false)
  })
})
