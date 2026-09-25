import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { Callout } from '@/components/editor/extensions/callout'
import { leaveCodeBlock } from '@/components/editor/extensions/codeBlock'
import { JottrDocument, Title } from '@/components/editor/extensions/title'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false }),
  Callout,
])

/** A page holding the given body blocks, with the caret in the last text
 *  position — which is where someone typing has just arrived. */
function page(...body: Node[]) {
  const doc = schema.node('doc', null, [schema.node('title', null, schema.text('Notes')), ...body])
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(doc.content.size), -1)))
}

function code(text: string) {
  return schema.node('codeBlock', null, text ? [schema.text(text)] : [])
}

function run(state: EditorState, command: Command) {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { state: next, applied }
}

function outline(state: EditorState) {
  return state.doc.children.map((node) => node.type.name)
}

describe('code block Enter', () => {
  it('leaves Enter on a line with code to the default: a new line in the block', () => {
    assert.equal(run(page(code('x = 1')), leaveCodeBlock).applied, false)
  })

  it('leaves Enter alone on a blank line that is not the last', () => {
    const start = page(code('x = 1\n\ny = 2'))
    const blank = start.apply(start.tr.setSelection(TextSelection.create(start.doc, start.doc.child(0).nodeSize + 7)))
    assert.equal(run(blank, leaveCodeBlock).applied, false)
  })

  it('leaves on one blank last line, as a callout does, taking the line with it', () => {
    const { state, applied } = run(page(code('x = 1\n')), leaveCodeBlock)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'codeBlock', 'paragraph'])
    assert.equal(state.doc.child(1).textContent, 'x = 1', 'the blank line is not left behind')
    assert.equal(state.selection.$from.parent.type.name, 'paragraph')
    assert.equal(state.selection.$from.index(0), 2, 'the caret is on the new line')
  })

  it('turns a block that was never written in back into a plain line', () => {
    const { state, applied } = run(page(code('')), leaveCodeBlock)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph'])
  })

  it('stays inside a callout that holds the code block', () => {
    const start = page(schema.node('callout', null, [code('x = 1\n')]))
    const { state, applied } = run(start, leaveCodeBlock)
    assert.equal(applied, true)
    assert.deepEqual(
      state.doc.child(1).children.map((node) => node.type.name),
      ['codeBlock', 'paragraph'],
    )
  })

  it('leaves Enter alone outside a code block', () => {
    const start = page(schema.node('paragraph'))
    assert.equal(run(start, leaveCodeBlock).applied, false)
  })
})
