import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CellSelection, TableMap, cellAround, isInTable, selectedRect } from '@tiptap/pm/tables'
import type { Mark, Node, ResolvedPos } from '@tiptap/pm/model'
import { Table } from '@tiptap/extension-table'
import { ySyncPluginKey } from 'y-prosemirror'

/** Finance mode: a per-table switch that formats the numbers in a table as
 *  money and prints a row of column totals under it.
 *
 *  The flag is a node attribute, so it rides the CRDT with the rest of the
 *  table and a table opened on another device is still in finance mode. The
 *  totals are the opposite — a decoration, computed on each device from the
 *  cells above them. A derived value has no business in a CRDT: two devices
 *  would take turns overwriting a number neither of them typed. Keeping it out
 *  of the document also makes it genuinely uneditable, keeps it out of the row
 *  count, and lets it inherit the column widths for free. */

/** Strict on purpose: a leading minus, digits in optional thousands groups, an
 *  optional decimal part. No exponents, no bare '.', no currency symbols — a
 *  cell has to look like a plain number before it is treated as one. */
const MONEY = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

/** Pinned to en-US rather than the device locale. The formatted text is written
 *  into the document and synced, so a phone in a comma-decimal locale must not
 *  write '1.234,00' into a table a laptop will later read back as 1.234. */
const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMoney(value: number): string {
  return MONEY_FORMAT.format(value)
}

export function parseMoney(text: string): number | null {
  const trimmed = text.trim()
  if (!MONEY.test(trimmed)) return null
  const value = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/** Cell text with the blocks kept apart, so two paragraphs holding '12' and
 *  '34' read as '12\n34' and fail to parse rather than totalling 1,234. */
function cellText(cell: Node): string {
  return cell.textBetween(0, cell.content.size, '\n')
}

/** Walks a table's cells once each, skipping the header row and the repeats a
 *  merged cell leaves behind in the map. */
function eachBodyCell(table: Node, visit: (cell: Node, offset: number, column: number) => void) {
  const map = TableMap.get(table)
  const seen = new Set<number>()
  for (let row = 0; row < map.height; row += 1) {
    for (let column = 0; column < map.width; column += 1) {
      const offset = map.map[row * map.width + column]
      if (seen.has(offset)) continue
      seen.add(offset)
      const cell = table.nodeAt(offset)
      // A header is a label, not an amount: a column headed '2024' should stay
      // a year rather than becoming 2,024.00 and joining the total.
      if (!cell || cell.type.name === 'tableHeader') continue
      visit(cell, offset, column)
    }
  }
}

/** Column totals, or null for a column with nothing to add up.
 *
 *  Summed in whole cents. Adding 0.1 and 0.2 as floats gives 0.30000000000000004,
 *  which is not a thing anyone wants to see at the bottom of an expenses table. */
export function columnTotals(table: Node): Array<number | null> {
  const totals = new Array<number | null>(TableMap.get(table).width).fill(null)
  eachBodyCell(table, (cell, _offset, column) => {
    const value = parseMoney(cellText(cell))
    if (value === null) return
    totals[column] = (totals[column] ?? 0) + Math.round(value * 100)
  })
  return totals.map((cents) => (cents === null ? null : cents / 100))
}

interface Edit {
  from: number
  to: number
  text: string
  marks: readonly Mark[]
}

/** The rewrite a single cell needs, or null if it is already right — or is not
 *  a number, or holds more than one block, in which case it is left alone. */
function cellEdit(doc: Node, cellPos: number): Edit | null {
  const cell = doc.nodeAt(cellPos)
  if (!cell || cell.type.name === 'tableHeader' || cell.childCount !== 1) return null
  const block = cell.firstChild
  if (!block || !block.isTextblock) return null

  const text = cellText(cell)
  const value = parseMoney(text)
  if (value === null) return null
  const formatted = formatMoney(value)
  if (formatted === text) return null

  // Past the cell's own token and its block's, to the first inline position.
  const from = cellPos + 2
  return {
    from,
    to: from + block.content.size,
    text: formatted,
    // Carried over so money that was bold stays bold.
    marks: block.firstChild?.marks ?? [],
  }
}

/** Format every body cell of one table. Used when finance mode is switched on,
 *  where reformatting the lot is exactly what was asked for. */
export function formatTableCells(tr: Transaction, tablePos: number): boolean {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return false
  return applyEdits(tr, tableEdits(tr.doc, tablePos), table.type.schema)
}

function tableEdits(doc: Node, tablePos: number): Edit[] {
  const table = doc.nodeAt(tablePos)
  if (!table) return []
  const edits: Edit[] = []
  eachBodyCell(table, (_cell, offset) => {
    const edit = cellEdit(doc, tablePos + 1 + offset)
    if (edit) edits.push(edit)
  })
  return edits
}

/** Applied back to front so that resizing one cell does not shift the positions
 *  of the edits still queued behind it. */
function applyEdits(tr: Transaction, edits: Edit[], schema: Node['type']['schema']): boolean {
  if (edits.length === 0) return false
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    tr.replaceWith(edit.from, edit.to, schema.text(edit.text, edit.marks))
  }
  return true
}

function totalRow(totals: Array<number | null>): HTMLElement {
  const row = document.createElement('tr')
  row.className = 'finance-total'
  row.setAttribute('contenteditable', 'false')
  totals.forEach((total, column) => {
    const cell = document.createElement('td')
    if (total === null) {
      // If nothing is being added up in the first column, that is where the row
      // says what it is.
      if (column === 0) cell.textContent = 'Total'
    } else {
      cell.textContent = formatMoney(total)
      cell.className = 'money'
    }
    row.appendChild(cell)
  })
  return row
}

/** The cell the selection is in, as a position before that cell.
 *
 *  `cellAround` looks for a row ancestor, which a CellSelection does not have —
 *  its $from already sits before a cell — so it has to be asked separately. */
function currentCell(state: EditorState): ResolvedPos | null {
  const { selection } = state
  if (selection instanceof CellSelection) return selection.$anchorCell
  return cellAround(selection.$from)
}

const financeKey = new PluginKey('financeMode')

export function financePlugin() {
  return new Plugin({
    key: financeKey,

    /** Formats the cell the caret has just left.
     *
     *  The trigger is that departure and nothing else. Reformatting on the
     *  state of the cell instead would reach across devices: while you are
     *  part-way through typing '12' here, any edit made on your other device
     *  runs this same hook there, sees a stray '12' that its own caret is not
     *  in, rewrites it to '12.00' and syncs that back into the cell you are
     *  still typing in. Your caret never left, so this never fires. */
    appendTransaction(transactions, oldState, newState) {
      // A remote change is another device's business; it formats its own cells.
      if (transactions.some((tr) => tr.getMeta(ySyncPluginKey)?.isChangeOrigin)) return null

      const before = currentCell(oldState)
      if (!before) return null

      let pos = before.pos
      for (const tr of transactions) {
        const mapped = tr.mapping.mapResult(pos)
        if (mapped.deleted) return null
        pos = mapped.pos
      }

      const after = currentCell(newState)
      if (after && after.pos === pos) return null

      if (pos < 0 || pos > newState.doc.content.size) return null
      const $cell = newState.doc.resolve(pos)
      if ($cell.depth < 1) return null
      const table = $cell.node(-1)
      if (table.type.name !== 'table' || !table.attrs.finance) return null

      const edit = cellEdit(newState.doc, pos)
      if (!edit) return null
      const tr = newState.tr
      applyEdits(tr, [edit], table.type.schema)
      return tr
    },

    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return true
          if (!node.attrs.finance) return false

          eachBodyCell(node, (cell, offset) => {
            if (parseMoney(cellText(cell)) === null) return
            const cellPos = pos + 1 + offset
            decorations.push(
              Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'money' }),
            )
          })

          const totals = columnTotals(node)
          decorations.push(
            Decoration.widget(pos + 1 + node.content.size, () => totalRow(totals), {
              side: 1,
              ignoreSelection: true,
              // Keyed on the figures, so the row is reused until one changes
              // rather than being rebuilt on every keystroke.
              key: `finance-total:${totals.join('|')}`,
            }),
          )
          // Tables do not nest here, so there is nothing below worth walking.
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    finance: {
      /** Turn finance mode on or off for the table holding the selection. */
      toggleFinance: () => ReturnType
    }
  }
}

/** The stock table node plus the finance flag, its command and its plugin. */
export const FinanceTable = Table.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      finance: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-finance') === 'true',
        renderHTML: (attributes) =>
          attributes.finance ? { 'data-finance': 'true' } : {},
      },
    }
  },

  addCommands() {
    return {
      ...(this.parent?.() ?? {}),
      toggleFinance:
        () =>
        ({ state, dispatch }) => {
          if (!isInTable(state)) return false
          const rect = selectedRect(state)
          const table = rect.table
          const tablePos = rect.tableStart - 1

          if (dispatch) {
            const finance = !table.attrs.finance
            const tr = state.tr.setNodeMarkup(tablePos, null, { ...table.attrs, finance })
            // Switching it on formats what is already there, the caret's own
            // cell included — unlike the drive-by formatting above, this is one
            // person asking for it here and now.
            if (finance) formatTableCells(tr, tablePos)
            dispatch(tr)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), financePlugin()]
  },
})
