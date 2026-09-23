import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { TableView } from '@tiptap/extension-table'

/** The narrowest an undragged column gets before the table stops shrinking and
 *  scrolls sideways instead, which is what keeps a table readable on a phone.
 *
 *  A dragged width is absolute pixels and follows the note to every device, so
 *  a first column pulled wide on a laptop is just as wide on a phone. The stock
 *  view lets the columns nobody dragged share what is left down to the drag
 *  floor, 40px, where a four-digit number breaks over four lines. Here they
 *  hold at this width and the wrapper scrolls, the way Notion does it. */
const UNSIZED_COLUMN_WIDTH = 100

/** The stock table view with a readable floor under the undragged columns.
 *
 *  It is a separate number from the drag floor rather than a raised
 *  `cellMinWidth`: that option also clamps every dragged column up to it, so a
 *  narrow column drawn on purpose would come back wider than it was left. */
export class ScrollingTableView extends TableView {
  constructor(node: Node, cellMinWidth: number, view?: EditorView, HTMLAttributes?: Record<string, unknown>) {
    super(node, cellMinWidth, view, HTMLAttributes)
    this.floorUnsizedColumns()
  }

  update(node: Node) {
    if (!super.update(node)) return false
    this.floorUnsizedColumns()
    return true
  }

  /** Only a table with an undragged column is touched. Once every column has
   *  been dragged the stock view pins the table to their sum, which is already
   *  as wide as asked for. */
  private floorUnsizedColumns() {
    const row = this.node.firstChild
    if (!row) return
    let total = 0
    let unsized = false
    row.forEach((cell) => {
      const { colspan, colwidth } = cell.attrs
      for (let j = 0; j < colspan; j += 1) {
        const width = colwidth?.[j]
        if (!width) unsized = true
        total += width ? Math.max(width, this.cellMinWidth) : UNSIZED_COLUMN_WIDTH
      }
    })
    if (unsized) this.table.style.minWidth = `${total}px`
  }
}
