import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit, createColGroup, createTable } from '@tiptap/extension-table'
import { Callout } from '@/components/editor/extensions/callout'
import { FinanceTable, addRowBelow, deleteEmptyRow } from '@/components/editor/extensions/finance'
import {
  CellSelection,
  TableMap,
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  selectedRect,
  toggleHeader,
} from '@tiptap/pm/tables'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { filterSlashItems } from '@/components/editor/extensions/slash'

/** The editor's real extension list, minus the ones that need a browser. The
 *  schema is what the table has to fit into, so it is built from the source of
 *  truth rather than a convenient subset. */
const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  TableKit.configure({ table: false }),
  FinanceTable.configure({ renderWrapper: true }),
])

/** A document shaped like a real page: title, paragraph, table. */
function page(rows: number, cols: number) {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Notes')),
    schema.node('paragraph'),
    createTable(schema, rows, cols, true),
  ])
  return EditorState.create({ doc, schema })
}

/** Ask the document where the table is rather than deriving it from node sizes,
 *  which silently slides by one as soon as the surrounding content changes. */
function locate(state: EditorState) {
  let pos = -1
  let node: Node | null = null
  state.doc.descendants((candidate, at) => {
    if (node || candidate.type.name !== 'table') return !node
    pos = at
    node = candidate
    return false
  })
  assert.ok(node, 'no table in the document')
  return { node: node as Node, map: TableMap.get(node), start: pos + 1 }
}

/** The position of the cell at `row`/`col` — the cell node itself, which is
 *  what CellSelection wants; +2 lands in the paragraph inside it. */
function cellAt(state: EditorState, row: number, col: number) {
  const { map, start } = locate(state)
  return start + map.map[row * map.width + col]
}

/** The same document with the caret parked inside one cell. */
function caretIn(state: EditorState, row = 0, col = 0) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, cellAt(state, row, col) + 2)),
  )
}

function pageWithTable(rows: number, cols: number, row = 0, col = 0) {
  return caretIn(page(rows, cols), row, col)
}

function dimensions(state: EditorState) {
  const rect = selectedRect(state)
  return { rows: rect.map.height, cols: rect.map.width }
}

/** Run a prosemirror-tables command the way the toolbar's chain does. */
function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: ReturnType<EditorState['tr']['setMeta']>) => void) => boolean,
) {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { state: next, applied }
}

describe('table block', () => {
  it('fits the page schema, which requires a title followed by blocks', () => {
    const state = pageWithTable(3, 3)
    // Throws if the document violates the schema's content expression.
    state.doc.check()
    assert.equal(state.doc.firstChild?.type.name, 'title')
    assert.equal(state.doc.lastChild?.type.name, 'table')
  })

  it('starts at the requested size, with a header row', () => {
    const state = pageWithTable(3, 4)
    assert.deepEqual(dimensions(state), { rows: 3, cols: 4 })
    const table = state.doc.lastChild as Node
    assert.equal(table.firstChild?.firstChild?.type.name, 'tableHeader')
    assert.equal(table.child(1).firstChild?.type.name, 'tableCell')
  })

  it('adds and removes rows', () => {
    let state = pageWithTable(3, 3)
    state = run(state, addRowAfter).state
    assert.deepEqual(dimensions(state), { rows: 4, cols: 3 })
    state = run(state, deleteRow).state
    assert.deepEqual(dimensions(state), { rows: 3, cols: 3 })
    state = run(state, deleteRow).state
    assert.deepEqual(dimensions(state), { rows: 2, cols: 3 })
  })

  it('adds and removes columns', () => {
    let state = pageWithTable(3, 3)
    state = run(state, addColumnAfter).state
    assert.deepEqual(dimensions(state), { rows: 3, cols: 4 })
    state = run(state, deleteColumn).state
    assert.deepEqual(dimensions(state), { rows: 3, cols: 3 })
  })

  it('keeps the content of the rows either side of an insert', () => {
    let state = page(2, 2)
    state = state.apply(state.tr.insertText('kept', cellAt(state, 1, 0) + 2))
    state = caretIn(state, 1, 0)
    state = run(state, addRowAfter).state
    assert.deepEqual(dimensions(state), { rows: 3, cols: 2 })
    assert.match(state.doc.textBetween(0, state.doc.content.size, '\n'), /kept/)
  })

  it('refuses to delete the last row or column, which is what the toolbar greys out', () => {
    // The guard the TableMenu mirrors: prosemirror-tables puts this check behind
    // the dispatch, so `can()` would claim the command is available.
    const oneRow = pageWithTable(1, 3)
    assert.equal(run(oneRow, deleteRow).applied, false)
    const rowRect = selectedRect(oneRow)
    assert.equal(rowRect.top === 0 && rowRect.bottom === rowRect.map.height, true)

    const oneCol = pageWithTable(3, 1)
    assert.equal(run(oneCol, deleteColumn).applied, false)
    const colRect = selectedRect(oneCol)
    assert.equal(colRect.left === 0 && colRect.right === colRect.map.width, true)
  })

  it('greys out a delete that would clear every row via a cell selection', () => {
    const state = page(3, 2)
    const spanned = state.apply(
      state.tr.setSelection(
        CellSelection.create(state.doc, cellAt(state, 0, 0), cellAt(state, 2, 0)),
      ),
    )
    const rect = selectedRect(spanned)
    assert.equal(rect.top === 0 && rect.bottom === rect.map.height, true)
    assert.equal(run(spanned, deleteRow).applied, false)
  })

  it('reads the header toggle off the top row, not the cell the caret is in', () => {
    // toggleHeaderRow always rewrites row 0, so the button's lit state has to
    // come from row 0 too — otherwise it goes dark the moment you click into
    // the body of the table.
    const headerOf = (state: EditorState) => {
      const rect = selectedRect(state)
      return rect.map
        .cellsInRect({ left: 0, top: 0, right: rect.map.width, bottom: 1 })
        .every((pos) => rect.table.nodeAt(pos)?.type.name === 'tableHeader')
    }

    const inHeader = pageWithTable(3, 3, 0, 0)
    const inBody = pageWithTable(3, 3, 2, 0)
    assert.equal(headerOf(inHeader), true)
    assert.equal(headerOf(inBody), true, 'the header row is still there from the body')

    // The caret-based reading the toolbar must not use disagrees here.
    assert.equal(selectedRect(inBody).table.nodeAt(cellAt(inBody, 2, 0) - locate(inBody).start)?.type.name, 'tableCell')

    // `toggleHeader('row')` is what Tiptap's toggleHeaderRow command calls.
    // prosemirror-tables also exports a `toggleHeaderRow` of its own, but that
    // one is the deprecated logic that acts on whichever row the caret is in —
    // using it here would test a function the app never runs.
    const toggleRow = toggleHeader('row')
    const toggled = run(inBody, toggleRow).state
    assert.equal(headerOf(toggled), false)
    assert.equal(headerOf(run(toggled, toggleRow).state), true)
  })

  it('carries cell text into the Yjs document that sync and search read', async () => {
    const { DOC_FIELD, readPlainText } = await import('@/lib/db/ydoc')
    const table = createTable(schema, 2, 2, true)
    const doc = schema.node('doc', null, [
      schema.node('title', null, schema.text('Notes')),
      schema.node('paragraph'),
      table,
    ])
    const state = EditorState.create({ doc, schema })
    const filled = state.apply(state.tr.insertText('findme', cellAt(state, 1, 0) + 2))

    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(filled.doc, ydoc.getXmlFragment(DOC_FIELD))
    // Search and page previews read this, so text inside a cell has to survive
    // the trip into the CRDT rather than being skipped as an unknown node.
    assert.match(readPlainText(ydoc), /findme/)
  })

  it('writes a resized width down one column, leaving the others alone', () => {
    // What a drag does, minus the mouse: prosemirror-tables sets colwidth on
    // every cell of the dragged column and touches no other column.
    let state = page(3, 3)
    const { map, start } = locate(state)
    for (let row = 0; row < map.height; row += 1) {
      const pos = start + map.map[row * map.width + 1]
      const cell = state.doc.nodeAt(pos) as Node
      state = state.apply(
        state.tr.setNodeMarkup(pos, null, { ...cell.attrs, colwidth: [220] }),
      )
    }

    const table = locate(state).node
    const widths = (row: number) =>
      [0, 1, 2].map((col) => table.child(row).child(col).attrs.colwidth)
    assert.deepEqual(widths(0), [null, [220], null])
    assert.deepEqual(widths(2), [null, [220], null], 'the width applies all the way down')
  })

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

  it('carries a column width to the other device', async () => {
    const { DOC_FIELD } = await import('@/lib/db/ydoc')
    const { yXmlFragmentToProsemirrorJSON } = await import('y-prosemirror')

    let state = page(2, 2)
    const { map, start } = locate(state)
    const pos = start + map.map[0]
    const cell = state.doc.nodeAt(pos) as Node
    state = state.apply(state.tr.setNodeMarkup(pos, null, { ...cell.attrs, colwidth: [180] }))

    // A resize is a node attribute, so it travels as ordinary document content:
    // widen a column on the laptop and the phone gets the same table.
    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(state.doc, ydoc.getXmlFragment(DOC_FIELD))
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc))

    const json = JSON.stringify(yXmlFragmentToProsemirrorJSON(other.getXmlFragment(DOC_FIELD)))
    assert.match(json, /"colwidth":\[180\]/)
  })

  it('offers the table block, but not inside a table', () => {
    const outside = { isActive: () => false } as never
    const inside = { isActive: (name: string) => name === 'table' } as never
    assert.equal(
      filterSlashItems('table', outside).some((item) => item.id === 'table'),
      true,
    )
    assert.equal(
      filterSlashItems('', inside).some((item) => item.id === 'table'),
      false,
    )
    // The other blocks are unaffected by the table guard.
    assert.equal(
      filterSlashItems('', inside).some((item) => item.id === 'bullet'),
      true,
    )
  })
  it('adds a row under the caret on Enter, with the caret in it', () => {
    const start = pageWithTable(3, 3, 1, 2)
    const { state, applied } = run(start, addRowBelow)
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(dimensions(state), { rows: 4, cols: 3 })
    // Below the caret's row, not at the foot of the table.
    assert.equal(state.selection.$from.pos, cellAt(state, 2, 2) + 2)
    assert.equal(state.selection.empty, true)
  })

  it('adds a body row, not a second header, on Enter in the header', () => {
    const { state } = run(pageWithTable(3, 3, 0, 0), addRowBelow)
    assert.equal((state.doc.lastChild as Node).child(1).firstChild?.type.name, 'tableCell')
    assert.equal(state.selection.$from.pos, cellAt(state, 1, 0) + 2)
  })

  it('leaves Enter alone inside a list in a cell, where it means next item', () => {
    let state = page(2, 2)
    const inner = cellAt(state, 1, 0)
    const list = schema.node('bulletList', null, [
      schema.node('listItem', null, [schema.node('paragraph', null, schema.text('one'))]),
    ])
    state = state.apply(state.tr.replaceWith(inner + 1, inner + 3, list))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inner + 5)))
    assert.equal(state.selection.$from.parent.textContent, 'one')
    assert.equal(run(state, addRowBelow).applied, false)
  })

  it('leaves Enter alone outside a table', () => {
    const state = page(2, 2)
    const inTitle = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    assert.equal(run(inTitle, addRowBelow).applied, false)
  })

  it('drops an empty row on Backspace, into the end of the cell above', () => {
    let state = pageWithTable(3, 2, 1, 1)
    // Text in the row above, so the caret's landing spot is checkable.
    state = state.apply(state.tr.insertText('abc', cellAt(state, 0, 1) + 2))
    const { state: after, applied } = run(caretIn(state, 2, 1), deleteEmptyRow)
    assert.equal(applied, true)
    after.doc.check()
    assert.deepEqual(dimensions(after), { rows: 2, cols: 2 })
    assert.equal(after.selection.$from.pos, cellAt(after, 1, 1) + 2)
  })

  it('lands in the cell above, at the end of its text', () => {
    let state = page(3, 2)
    state = state.apply(state.tr.insertText('abc', cellAt(state, 0, 1) + 2))
    const { state: after } = run(caretIn(state, 1, 1), deleteEmptyRow)
    assert.deepEqual(dimensions(after), { rows: 2, cols: 2 })
    assert.equal(after.selection.$from.parent.textContent, 'abc')
    assert.equal(after.selection.$from.parentOffset, 3)
  })

  it('leaves Backspace alone in a row with anything in it', () => {
    let state = page(3, 2)
    state = state.apply(state.tr.insertText('x', cellAt(state, 1, 0) + 2))
    assert.equal(run(caretIn(state, 1, 1), deleteEmptyRow).applied, false)
  })

  it('keeps the last row', () => {
    assert.equal(run(pageWithTable(1, 2, 0, 0), deleteEmptyRow).applied, false)
  })
})
