import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit, createTable } from '@tiptap/extension-table'
import { EditorState } from '@tiptap/pm/state'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { FinanceTable } from '@/components/editor/extensions/finance'
import { planTrade, setColumnWidths, storedWidths } from '@/components/editor/extensions/tableResize'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false }),
  TableKit.configure({ table: false }),
  FinanceTable,
])

function tableState(cols: number) {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Grid')),
    createTable(schema, 3, cols, true),
  ])
  const state = EditorState.create({ doc, schema })
  let tablePos = -1
  doc.forEach((node, offset) => {
    if (node.type.name === 'table') tablePos = offset
  })
  return { state, tablePos }
}

describe('planTrade', () => {
  it('trades width between the two columns either side of the line', () => {
    // The second line of four unsized columns: the fourth stays unsized, so
    // the table still fills the page.
    const writes = planTrade([150, 150, 150, 150], [0, 0, 0, 0], 1, 30, 40)
    assert.deepEqual([...writes], [
      [1, 180],
      [2, 120],
    ])
  })

  it('leaves the right-hand column unsized when it is the last unsized one', () => {
    // The second line of three, the first already dragged: writing both would
    // pin the table to its width.
    const writes = planTrade([100, 175, 175], [100, 0, 0], 1, 25, 40)
    assert.deepEqual([...writes], [[1, 200]])
  })

  it('leaves the left-hand column unsized when it is the last unsized one', () => {
    const writes = planTrade([100, 175, 175], [100, 0, 175], 1, -25, 40)
    assert.deepEqual([...writes], [[2, 200]])
  })

  it('keeps a pinned table at its width', () => {
    const writes = planTrade([100, 200, 150], [100, 200, 150], 0, 50, 40)
    assert.deepEqual([...writes], [
      [0, 150],
      [1, 150],
    ])
  })

  it('stops each column at the floor', () => {
    assert.deepEqual([...planTrade([150, 150, 150], [0, 0, 0], 0, 500, 40)], [
      [0, 260],
      [1, 40],
    ])
    assert.deepEqual([...planTrade([150, 150, 150], [0, 0, 0], 0, -500, 40)], [
      [0, 40],
      [1, 260],
    ])
  })
})

describe('setColumnWidths', () => {
  it('writes each width onto every cell in its column', () => {
    const { state, tablePos } = tableState(3)
    const tr = setColumnWidths(state.tr, tablePos, new Map([[1, 180], [2, 120]]))
    const table = tr.doc.nodeAt(tablePos)!
    assert.deepEqual(storedWidths(table), [0, 180, 120])
    table.forEach((row) => {
      assert.deepEqual(
        [0, 1, 2].map((i) => row.child(i).attrs.colwidth?.[0] ?? 0),
        [0, 180, 120],
      )
    })
  })
})
