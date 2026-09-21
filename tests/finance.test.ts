import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getExtensionField, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit, createTable } from '@tiptap/extension-table'
import { TableMap } from '@tiptap/pm/tables'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment, ySyncPluginKey } from 'y-prosemirror'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import {
  FinanceTable,
  columnTotals,
  financePlugin,
  formatMoney,
  formatTableCells,
  parseMoney,
} from '@/components/editor/extensions/finance'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false }),
  TableKit.configure({ table: false }),
  FinanceTable,
])

/** A page whose table is in finance mode, with `values` laid into the body
 *  rows. The header row is left as it comes, which is to say empty. */
function financePage(values: string[][]) {
  const cols = values[0].length
  const table = createTable(schema, values.length + 1, cols, true)
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Books')),
    schema.node('paragraph'),
    table,
  ])
  let state = EditorState.create({ doc, schema, plugins: [financePlugin()] })

  const tablePos = locate(state).start - 1
  state = state.apply(
    state.tr.setNodeMarkup(tablePos, null, { ...table.attrs, finance: true }),
  )

  // Filled back to front so that earlier positions survive the edits.
  for (let row = values.length - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      const text = values[row][col]
      if (text) state = state.apply(state.tr.insertText(text, cellAt(state, row + 1, col) + 2))
    }
  }
  return state
}

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

function cellAt(state: EditorState, row: number, col: number) {
  const { map, start } = locate(state)
  return start + map.map[row * map.width + col]
}

function textAt(state: EditorState, row: number, col: number) {
  const cell = state.doc.nodeAt(cellAt(state, row, col)) as Node
  return cell.textBetween(0, cell.content.size, '\n')
}

const caretIn = (state: EditorState, row: number, col: number) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, cellAt(state, row, col) + 2)))

/** The caret after the last character of a cell, where typing actually happens. */
const caretAfter = (state: EditorState, row: number, col: number) =>
  state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, cellAt(state, row, col) + 2 + textAt(state, row, col).length),
    ),
  )

describe('finance mode', () => {
  it('formats a plain number as money', () => {
    assert.equal(formatMoney(1234), '1,234.00')
    assert.equal(formatMoney(0.5), '0.50')
    assert.equal(formatMoney(-1234.567), '-1,234.57')
    assert.equal(formatMoney(1234567), '1,234,567.00')
  })

  it('reads back exactly what it wrote', () => {
    for (const value of [0, 1234, -1234.56, 1234567.89, 0.01]) {
      assert.equal(parseMoney(formatMoney(value)), value)
    }
    // Formatting is a fixed point, which is what stops the editor from
    // rewriting the same cell on every pass.
    assert.equal(formatMoney(parseMoney('1,234.00') as number), '1,234.00')
  })

  it('leaves anything that is not plainly a number alone', () => {
    for (const text of ['', 'Rent', '$50', '12abc', '.5', '1e6', '1,23', '--5', '12 34']) {
      assert.equal(parseMoney(text), null, `${text} should not parse`)
    }
    assert.equal(parseMoney('  42  '), 42, 'surrounding space is fine')
  })

  it('totals each column in cents, so the pennies do not drift', () => {
    const state = financePage([
      ['0.10', '1234'],
      ['0.20', '1'],
    ])
    // 0.1 + 0.2 in floating point is 0.30000000000000004, which is not a thing
    // anyone wants at the bottom of an expenses table.
    assert.deepEqual(columnTotals(locate(state).node), [0.3, 1235])
  })

  it('ignores the header row and any cell that is not a number', () => {
    let state = financePage([
      ['Rent', '1200'],
      ['Food', '300'],
    ])
    // A header of '2024' would otherwise become 2,024.00 and join the total.
    state = state.apply(state.tr.insertText('2024', cellAt(state, 0, 1) + 2))
    assert.deepEqual(columnTotals(locate(state).node), [null, 1500])
    assert.equal(textAt(state, 0, 1), '2024', 'the header keeps its year')
  })

  it('formats the whole table when finance mode is switched on', () => {
    const state = financePage([
      ['Rent', '1200'],
      ['Food', '99.5'],
    ])
    const tr = state.tr
    assert.equal(formatTableCells(tr, locate(state).start - 1), true)
    const formatted = state.apply(tr)
    assert.equal(textAt(formatted, 1, 1), '1,200.00')
    assert.equal(textAt(formatted, 2, 1), '99.50')
    assert.equal(textAt(formatted, 1, 0), 'Rent', 'words are left as words')
  })

  it('leaves the cell being typed in alone, and formats it on the way out', () => {
    let state = financePage([['Rent', '1200']])
    state = caretAfter(state, 1, 1)
    state = state.apply(state.tr.insertText('5'))
    // Mid-keystroke: reformatting here would fight the person typing.
    assert.equal(textAt(state, 1, 1), '12005')

    state = caretIn(state, 1, 0)
    assert.equal(textAt(state, 1, 1), '12,005.00')
  })

  it('never reformats a cell because of an edit made on another device', () => {
    // The bug this guards: device B's own edits run this same hook, and a naive
    // "any unformatted cell" rule would have B rewrite the cell A is still
    // typing in and sync it back mid-word.
    let state = financePage([['Rent', '1200']])
    state = caretIn(state, 1, 1)

    const remote = state.tr
      .setSelection(TextSelection.create(state.doc, cellAt(state, 1, 0) + 2))
      .setMeta(ySyncPluginKey, { isChangeOrigin: true })
    state = state.apply(remote)

    assert.equal(textAt(state, 1, 1), '1200', 'a remote change formats nothing')
  })

  it('settles rather than reformatting for ever', () => {
    let state = financePage([['Rent', '1200']])
    state = caretIn(state, 1, 1)
    state = caretIn(state, 1, 0)
    assert.equal(textAt(state, 1, 1), '1,200.00')

    // A second departure from an already-formatted cell must produce no edit,
    // or appendTransaction would feed itself.
    const before = state.doc.toJSON()
    state = caretIn(state, 1, 1)
    state = caretIn(state, 1, 0)
    assert.deepEqual(state.doc.toJSON(), before)
  })

  it('hangs the totals row off the end of the table, outside the document', () => {
    const plugin = financePlugin()
    const state = EditorState.create({
      doc: financePage([['Rent', '1200'], ['Food', '300']]).doc,
      schema,
      plugins: [plugin],
    })
    const decorations = plugin.props.decorations?.call(plugin, state) as DecorationSet
    const { node, start } = locate(state)
    const end = start + node.content.size

    const widgets = decorations.find(end, end)
    assert.equal(widgets.length, 1, 'one totals row, at the end of the table')
    assert.equal(widgets[0].from, end)
    assert.equal(widgets[0].to, end)

    // It is a decoration, so the document still holds three rows and the row
    // count the toolbar shows stays honest.
    assert.equal(node.childCount, 3)
    assert.equal(state.doc.textBetween(0, state.doc.content.size, '\n').includes('1,500'), false)
  })

  it('keeps every command the stock table node brought with it', () => {
    // addCommands and addProseMirrorPlugins both spread `this.parent?.()`. Drop
    // that spread and the toolbar's row and column buttons quietly stop
    // existing — nothing else in these tests goes through the Tiptap commands,
    // so this is the one place that would notice.
    const context = { name: FinanceTable.name, options: FinanceTable.options, storage: {} }
    const commands = getExtensionField<() => Record<string, unknown>>(
      FinanceTable,
      'addCommands',
      context,
    )()

    for (const name of [
      'insertTable',
      'addRowAfter',
      'deleteRow',
      'addColumnAfter',
      'deleteColumn',
      'deleteTable',
      'toggleHeaderRow',
      'toggleFinance',
    ]) {
      assert.ok(name in commands, `${name} should still be a command`)
    }
  })

  it('carries finance mode to the other device', async () => {
    const { DOC_FIELD } = await import('@/lib/db/ydoc')
    const { yXmlFragmentToProsemirrorJSON } = await import('y-prosemirror')

    const state = financePage([['Rent', '1200']])
    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(state.doc, ydoc.getXmlFragment(DOC_FIELD))
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc))

    const json = yXmlFragmentToProsemirrorJSON(other.getXmlFragment(DOC_FIELD))
    assert.match(JSON.stringify(json), /"finance":true/)
  })
})
