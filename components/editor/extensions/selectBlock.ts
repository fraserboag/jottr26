import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/** A click on the edge of a boxed block selects the block whole, ready to be
 *  deleted or cut, the way a click on a subpage list does. The edge is the
 *  box's padding: a callout's, an open accordion's body, a code block's. A
 *  click on the text inside, or beside it, still puts the caret there.
 *
 *  A table's cells run right to its border, so its edge is the strip just
 *  above and below it, and the border itself. A folded accordion has no box
 *  showing, and so no edge to click.
 *
 *  A table selected whole comes out as every one of its cells selected, which
 *  is how the table editing is built, so a table in that state is marked, and
 *  ringed like any other block selected whole rather than tinted cell by
 *  cell. */

export interface Box {
  left: number
  top: number
  width: number
  height: number
  padding: { top: number; right: number; bottom: number; left: number }
}

/** Whether a point is inside a box. The box stops short of any scrollbar, so
 *  a click on one is still a scroll. */
export function within(box: Box, x: number, y: number) {
  const { left, top, width, height } = box
  return x >= left && x < left + width && y >= top && y < top + height
}

/** Whether a point is on a box's padding: inside the box, not in the middle
 *  of it where its content goes. */
export function onEdge(box: Box, x: number, y: number) {
  const { left, top, width, height, padding } = box
  if (!within(box, x, y)) return false
  const inside =
    x >= left + padding.left &&
    x < left + width - padding.right &&
    y >= top + padding.top &&
    y < top + height - padding.bottom
  return !inside
}

function boxOf(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return {
    // The padding box: inside the border, and short of a scrollbar.
    left: rect.left + element.clientLeft,
    top: rect.top + element.clientTop,
    width: element.clientWidth,
    height: element.clientHeight,
    padding: {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    },
  }
}

const BOXES = 'div[data-type="callout"], div[data-type="accordionBody"], pre, .tableWrapper'

/** The element drawn for the block a click on this box's edge selects: the
 *  box itself, or for an accordion's body, the accordion around it. */
function blockOf(box: Element) {
  return box.matches('div[data-type="accordionBody"]') ? box.closest('div[data-type="accordion"]') : box
}

/** The position of the node a block element was drawn for. */
function posOf(view: EditorView, element: Element) {
  let pos: number
  try {
    pos = view.posAtDOM(element, 0)
  } catch {
    return null
  }
  const $pos = view.state.doc.resolve(pos)
  if (view.nodeDOM(pos) === element) return pos
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (view.nodeDOM($pos.before(depth)) === element) return $pos.before(depth)
  }
  return null
}

/** The table whose cells are all selected, marked `table-selected`. */
export function wholeTable(state: EditorState) {
  const { selection } = state
  if (!(selection instanceof CellSelection) || !selection.isRowSelection() || !selection.isColSelection()) {
    return DecorationSet.empty
  }
  // The cell's row, then the row's table.
  const $cell = selection.$anchorCell
  const pos = $cell.before($cell.depth - 1)
  const table = $cell.node($cell.depth - 1)
  return DecorationSet.create(state.doc, [Decoration.node(pos, pos + table.nodeSize, { class: 'table-selected' })])
}

export const SelectBlock = Extension.create({
  name: 'selectBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('selectBlock'),
        props: {
          decorations: wholeTable,
          handleDOMEvents: {
            mousedown(view, event) {
              // A held key is the editor's own: extending a selection, or
              // selecting the block already.
              if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
              const target = event.target
              if (!(target instanceof HTMLElement)) return false
              const box = target.closest<HTMLElement>(BOXES)
              if (!box || !view.dom.contains(box)) return false

              const hit = box.matches('.tableWrapper')
                ? (target === box || target.matches('table')) && within(boxOf(box), event.clientX, event.clientY)
                : onEdge(boxOf(box), event.clientX, event.clientY)
              if (!hit) return false

              const block = blockOf(box)
              const pos = block && posOf(view, block)
              if (pos === null || pos === undefined) return false

              event.preventDefault()
              view.focus()
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
              return true
            },
          },
        },
      }),
    ]
  },
})
