import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createColGroup, createTable } from '@tiptap/extension-table'
import { EditorState } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { planTrade, setColumnWidths, storedWidths } from '@/components/editor/extensions/tableResize'
import { pageSchema } from './editor'

const schema = pageSchema

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

describe('an unsized table', () => {
  it('keeps the table fluid until every column has been sized', () => {
    // The stylesheet gives the table `width: 100%`, which an inline `width`
    // would beat. createColGroup only emits one once every column is sized, so
    // a half-resized table still stretches to the page rather than freezing at
    // the sum of its columns.
    const unsized = createTable(schema, 2, 2, true)
    assert.equal(createColGroup(unsized, 40).tableWidth, '')
    assert.equal(createColGroup(unsized, 40).tableMinWidth, '80px')

    const sizeRow = (node: Node, cols: number[]) =>
      schema.node(
        'table',
        node.attrs,
        Array.from({ length: node.childCount }, (_, row) =>
          schema.node(
            'tableRow',
            node.child(row).attrs,
            cols.map((width, col) => {
              const cell = node.child(row).child(col)
              return cell.type.create({ ...cell.attrs, colwidth: [width] }, cell.content)
            }),
          ),
        ),
      )

    const half = sizeRow(unsized, [150, 0])
    assert.equal(createColGroup(half, 40).tableWidth, '', 'one column sized is still fluid')

    const whole = sizeRow(unsized, [150, 90])
    assert.equal(createColGroup(whole, 40).tableWidth, '240px')
  })
})
