import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor, type JSONContent } from '@tiptap/core'
import { EditorState, NodeSelection } from '@tiptap/pm/state'
import { CellSelection, deleteTable, tableEditing } from '@tiptap/pm/tables'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { AccordionKit } from '@/components/editor/extensions/accordion'
import { Callout } from '@/components/editor/extensions/callout'
import { onEdge, wholeTable, type Box } from '@/components/editor/extensions/selectBlock'

/** A callout's box: 200 by 100 at the origin, padded 20 by 22. */
const box: Box = { left: 0, top: 0, width: 200, height: 100, padding: { top: 20, right: 22, bottom: 20, left: 22 } }

describe('the edge of a box', () => {
  it('is its padding, on every side', () => {
    for (const [x, y] of [
      [5, 50],
      [195, 50],
      [100, 5],
      [100, 95],
      [0, 0],
    ]) {
      assert.equal(onEdge(box, x, y), true, `${x},${y}`)
    }
  })

  it('is not the middle, where the text is', () => {
    for (const [x, y] of [
      [100, 50],
      [22, 20],
      [177, 79],
    ]) {
      assert.equal(onEdge(box, x, y), false, `${x},${y}`)
    }
  })

  it('is not outside the box, which is where a scrollbar sits', () => {
    for (const [x, y] of [
      [100, 100],
      [100, 110],
      [-1, 50],
      [200, 50],
    ]) {
      assert.equal(onEdge(box, x, y), false, `${x},${y}`)
    }
  })
})

const text = (value: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })

function editor(block: JSONContent) {
  return new Editor({
    element: null,
    extensions: [StarterKit.configure({ undoRedo: false }), Callout, ...AccordionKit, TableKit],
    content: { type: 'doc', content: [text('Before'), block, text('After')] },
  })
}

/** Select the block between the two lines whole, as a click on its edge does. */
function selectBlock(instance: Editor) {
  const pos = instance.state.doc.child(0).nodeSize
  instance.commands.setNodeSelection(pos)
}

const types = (instance: Editor) => instance.getJSON().content?.map((block) => block.type)

describe('a block selected whole', () => {
  const blocks: [string, JSONContent][] = [
    ['callout', { type: 'callout', content: [text('Note')] }],
    [
      'accordion',
      {
        type: 'accordion',
        content: [
          { type: 'accordionTitle', content: [{ type: 'text', text: 'Details' }] },
          { type: 'accordionBody', content: [text('Inside')] },
        ],
      },
    ],
    ['codeBlock', { type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1' }] }],
  ]

  for (const [name, block] of blocks) {
    it(`goes, as a ${name}, when it is deleted`, () => {
      const instance = editor(block)
      selectBlock(instance)
      const { selection } = instance.state
      assert.ok(selection instanceof NodeSelection && selection.node.type.name === name)
      instance.commands.deleteSelection()
      assert.deepEqual(types(instance), ['paragraph', 'paragraph'])
    })
  }

  it('is every cell, for a table, which is what deletes a table', () => {
    const cell = (value: string): JSONContent => ({ type: 'tableCell', content: [text(value)] })
    const row = (...values: string[]): JSONContent => ({ type: 'tableRow', content: values.map(cell) })
    const { doc, schema } = editor({ type: 'table', content: [row('a', 'b'), row('c', 'd')] }).state
    // The table plugin as the editor has it, which a headless editor leaves out.
    let state = EditorState.create({ schema, doc, plugins: [tableEditing()] })
    state = state.apply(state.tr.setSelection(NodeSelection.create(doc, doc.child(0).nodeSize)))
    const { selection } = state
    assert.ok(selection instanceof CellSelection)
    assert.ok(selection.isRowSelection() && selection.isColSelection())
    deleteTable(state, (tr) => (state = state.apply(tr)))
    assert.deepEqual(
      state.doc.content.content.map((block) => block.type.name),
      ['paragraph', 'paragraph'],
    )
  })

  it('is marked as a table selected whole, and a few of its cells are not', () => {
    const cell = (value: string): JSONContent => ({ type: 'tableCell', content: [text(value)] })
    const row = (...values: string[]): JSONContent => ({ type: 'tableRow', content: values.map(cell) })
    const { doc, schema } = editor({ type: 'table', content: [row('a', 'b'), row('c', 'd')] }).state
    const tablePos = doc.child(0).nodeSize
    let state = EditorState.create({ schema, doc, plugins: [tableEditing()] })
    state = state.apply(state.tr.setSelection(NodeSelection.create(doc, tablePos)))
    const marked = wholeTable(state).find()
    assert.equal(marked.length, 1)
    assert.equal(marked[0].from, tablePos)
    assert.equal(marked[0].to, tablePos + doc.child(1).nodeSize)

    // Just the first cell, which is at the table's start, past the table and
    // row openings.
    const firstCell = tablePos + 2
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, firstCell)))
    assert.equal(wholeTable(state).find().length, 0)
  })
})
