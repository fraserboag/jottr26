import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TextSelection } from '@tiptap/pm/state'
import { leaveCodeBlock } from '@/components/editor/extensions/codeBlock'
import { outline, page, pageSchema as schema, run } from './editor'

function code(text: string) {
  return schema.node('codeBlock', null, text ? [schema.text(text)] : [])
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

describe('code block Shift-Enter', () => {
  it('is a new line in the code, even on a blank last line', async () => {
    const { newlineInCode } = await import('@tiptap/pm/commands')
    const { state, applied } = run(page(code('x = 1\n')), newlineInCode)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'codeBlock'])
    assert.equal(state.doc.child(1).textContent, 'x = 1\n\n')
  })
})
