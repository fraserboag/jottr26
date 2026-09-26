import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Selection, type Command } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { ACCORDION_BODY } from './accordion'
import { isCellNode, isEmptyParagraph, replaceWithEmptyLine } from './helpers'
import { selectsWholeTable } from './selectBlock'

/** The boxes that are written in rather than being blocks of their own: a
 *  table cell, an accordion's body. Their last line is emptied rather than
 *  deleted, since the box can't go without one and can't go on its own. */
function keepsALine(node: PMNode) {
  return isCellNode(node) || node.type.name === ACCORDION_BODY
}

/** The keyboard bar's delete button: the line the caret is on, gone whole —
 *  or the block selected, or every line a selection touches.
 *
 *  A line that is all there is of its block takes the block with it: the only
 *  line of a callout, a list item's line, an accordion's or a subpage list's
 *  heading. The page itself, a table cell and an accordion's body are left
 *  holding one empty line instead, so there is always somewhere to type. The
 *  title is a field of its own and is never deleted.
 *
 *  The caret goes on to the start of the next line, or to the end of the one
 *  above when there is nothing after. */
export const deleteLine: Command = (state, dispatch) => {
  const { selection } = state
  let $at: ResolvedPos
  let depth: number
  let start: number
  let end: number
  if (selection instanceof CellSelection) {
    // Some of a table's cells are neither a line nor a block.
    if (!selectsWholeTable(selection)) return false
    // Before the cell is inside its row, which is inside the table.
    $at = selection.$anchorCell
    depth = $at.depth - 2
    start = $at.index(depth)
    end = start + 1
  } else {
    // A caret between blocks, as beside a table, is on no line; the range
    // around it would be whatever box it sits in.
    if (selection.empty && !selection.$from.parent.inlineContent) return false
    const range = selection.$from.blockRange(selection.$to)
    if (!range) return false
    $at = range.$from
    ;({ depth, startIndex: start, endIndex: end } = range)
  }

  for (;;) {
    const parent = $at.node(depth)
    const first = depth === 0 ? 1 : 0
    if (start < first) return false
    const all = start === first && end === parent.childCount

    if (all && (depth === 0 || keepsALine(parent))) {
      if (parent.childCount === first + 1 && isEmptyParagraph(parent.child(first))) return false
      return replaceWithEmptyLine(state, dispatch, $at.posAtIndex(first, depth), $at.end(depth))
    }

    if (all || !parent.canReplace(start, end)) {
      if (depth === 0) return false
      depth -= 1
      start = $at.index(depth)
      end = start + 1
      continue
    }

    if (dispatch) {
      const from = $at.posAtIndex(start, depth)
      const tr = state.tr.delete(from, $at.posAtIndex(end, depth))
      const $pos = tr.doc.resolve(from)
      const after = Selection.findFrom($pos, 1, true)
      const before = Selection.findFrom($pos, -1, true)
      // Never back up into the title: with only a divider left below it, the
      // divider is selected instead.
      const aboveTitle = before && before.from < tr.doc.firstChild!.nodeSize
      dispatch(tr.setSelection(after ?? (before && !aboveTitle ? before : Selection.near($pos))).scrollIntoView())
    }
    return true
  }
}
