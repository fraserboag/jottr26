import { Plugin, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { TableMap, columnResizingPluginKey } from '@tiptap/pm/tables'

/** Column drags that move only the line under the pointer.
 *
 *  The stock drag writes a width onto the column left of the line and nothing
 *  else. The columns nobody has dragged split whatever is left between them
 *  evenly, so the ones on both sides of the line gave way at once and the
 *  column seemed to grow from both edges. Here a drag trades width between the
 *  two columns either side of the line instead: one gains what the other
 *  loses, and every other line stays where it was.
 *
 *  The stock plugin still finds the line under the pointer, draws the handle
 *  and holds it while dragging. This one takes the mousedown ahead of it and
 *  does the drag itself. */
export function columnTrade(cellMinWidth: number, handleWidth: number) {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          dropStrayHandle(view, event, handleWidth)
          return false
        },
        mousedown: (view, event) => {
          dropStrayHandle(view, event, handleWidth)
          return startTrade(view, event, cellMinWidth)
        },
      },
    },
  })
}

/** Lets go of a line the pointer is no longer on.
 *
 *  The stock plugin keeps the last line it found when the pointer lands on the
 *  table's outer edge, which it declines to take as a line, so a pointer that
 *  gets there without crossing a cell on the way would drag that line from
 *  somewhere else entirely. */
function dropStrayHandle(view: EditorView, event: MouseEvent, handleWidth: number) {
  const handle = columnResizingPluginKey.getState(view.state)
  if (!handle || handle.activeHandle === -1 || handle.dragging) return
  const cell = view.nodeDOM(handle.activeHandle) as HTMLElement | null
  const line = cell?.getBoundingClientRect().right
  if (line !== undefined && Math.abs(event.clientX - line) <= handleWidth + 1) return
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }))
}

/** Each column's stored width, 0 where it has none. */
export function storedWidths(table: Node): number[] {
  const widths: number[] = []
  table.firstChild?.forEach((cell) => {
    const { colspan, colwidth } = cell.attrs
    for (let j = 0; j < colspan; j += 1) widths.push(colwidth?.[j] || 0)
  })
  return widths
}

/** What a drag of `dx` on the line after column `col` writes, from the widths
 *  the columns are drawn at and the ones they have stored.
 *
 *  Both columns are written, except that the table is never pinned by a drag:
 *  a table with an unsized column fills the page, so if writing both would
 *  leave none, the one of the pair that had no width keeps none and takes up
 *  the difference itself, which comes to the same line. */
export function planTrade(
  drawn: number[],
  stored: number[],
  col: number,
  dx: number,
  min: number,
): Map<number, number> {
  const pair = drawn[col] + drawn[col + 1]
  const left = Math.round(Math.min(Math.max(drawn[col] + dx, min), pair - min))
  const writes = new Map([
    [col, left],
    [col + 1, Math.round(pair) - left],
  ])
  const unsizedElsewhere = stored.some((width, i) => !width && i !== col && i !== col + 1)
  if (!unsizedElsewhere) {
    if (!stored[col + 1]) writes.delete(col + 1)
    else if (!stored[col]) writes.delete(col)
  }
  return writes
}

/** Writes `widths` onto every cell over those columns, as the stock drag does
 *  for its one column. */
export function setColumnWidths(tr: Transaction, tablePos: number, widths: Map<number, number>) {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return tr
  const map = TableMap.get(table)
  const start = tablePos + 1
  for (const [col, width] of widths) {
    for (let row = 0; row < map.height; row += 1) {
      const cellPos = map.map[row * map.width + col]
      const cell = tr.doc.nodeAt(start + cellPos) as Node
      const index = col - map.colCount(cellPos)
      if (cell.attrs.colwidth?.[index] === width) continue
      const colwidth = cell.attrs.colwidth?.slice() ?? Array(cell.attrs.colspan).fill(0)
      colwidth[index] = width
      tr.setNodeMarkup(start + cellPos, null, { ...cell.attrs, colwidth })
    }
  }
  return tr
}

/** The width each column is drawn at: its stored width if it has one, which
 *  is what the colgroup gives it, and otherwise measured off a cell that sits
 *  in that column alone. */
function drawnWidths(view: EditorView, table: Node, tablePos: number, stored: number[]) {
  const map = TableMap.get(table)
  return stored.map((width, col) => {
    if (width) return width
    let fallback = 0
    for (let row = 0; row < map.height; row += 1) {
      const cellPos = map.map[row * map.width + col]
      const dom = view.nodeDOM(tablePos + 1 + cellPos) as HTMLElement | null
      if (!dom) continue
      const colspan = table.nodeAt(cellPos)?.attrs.colspan ?? 1
      const drawn = dom.getBoundingClientRect().width
      if (colspan === 1) return drawn
      fallback ||= drawn / colspan
    }
    return fallback
  })
}

function startTrade(view: EditorView, event: MouseEvent, cellMinWidth: number) {
  if (!view.editable) return false
  const handle = columnResizingPluginKey.getState(view.state)
  if (!handle || handle.activeHandle === -1 || handle.dragging) return false

  const $cell = view.state.doc.resolve(handle.activeHandle)
  const table = $cell.node(-1)
  const tablePos = $cell.before(-1)
  const map = TableMap.get(table)
  const col = map.colCount($cell.pos - $cell.start(-1)) + ($cell.nodeAfter?.attrs.colspan ?? 1) - 1
  // The table's own right edge is not a line between two columns.
  if (col >= map.width - 1) return true

  const stored = storedWidths(table)
  const drawn = drawnWidths(view, table, tablePos, stored)
  const startX = event.clientX
  const win = view.dom.ownerDocument.defaultView ?? window

  // Before the colgroup is touched: this redraws the table, which would put
  // back the widths the preview below sets.
  view.dispatch(
    view.state.tr.setMeta(columnResizingPluginKey, {
      setDragging: { startX, startWidth: drawn[col] },
    }),
  )

  const colgroup = (view.nodeDOM(tablePos) as HTMLElement | null)?.querySelector('colgroup')
  const preview = (dx: number) => {
    const pair = drawn[col] + drawn[col + 1]
    const left = Math.min(Math.max(drawn[col] + dx, cellMinWidth), pair - cellMinWidth)
    const cols = colgroup?.children
    if (!cols) return
    ;(cols[col] as HTMLElement).style.width = `${left}px`
    ;(cols[col + 1] as HTMLElement).style.width = `${pair - left}px`
  }

  const move = (e: MouseEvent) => {
    if (!e.buttons) return finish(e)
    preview(e.clientX - startX)
  }
  const finish = (e: MouseEvent) => {
    win.removeEventListener('mousemove', move)
    win.removeEventListener('mouseup', finish)
    const tr = view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null })
    const dx = e.clientX - startX
    // Found again from the handle, which the stock plugin carries through any
    // edit, so an edit synced in above the table mid-drag does not lose it.
    const now = columnResizingPluginKey.getState(view.state)?.activeHandle ?? -1
    const $now = now === -1 ? null : view.state.doc.resolve(now)
    // A click on the line with no drag leaves the widths as they were.
    if (dx !== 0 && $now && TableMap.get($now.node(-1)).width === map.width) {
      setColumnWidths(tr, $now.before(-1), planTrade(drawn, stored, col, dx, cellMinWidth))
    }
    view.dispatch(tr)
  }

  win.addEventListener('mousemove', move)
  win.addEventListener('mouseup', finish)
  event.preventDefault()
  return true
}
