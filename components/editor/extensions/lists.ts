import { ListItem as BaseListItem } from '@tiptap/extension-list'
import type { Node } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

/** A list item whose first line can be an accordion as well as a paragraph.
 *
 *  Paragraph comes first in the choice: that is what a new item is filled
 *  with, so Enter and Tab keep making plain bullets. */
const content = '(paragraph | accordion) block*'

const LIST_ITEM = 'listItem'
const LISTS = ['bulletList', 'orderedList']

/** The list nested straight under an item's first line, if it has one. */
export function nestedList(item: Node) {
  if (item.type.name !== LIST_ITEM) return null
  const next = item.maybeChild(1)
  return next && LISTS.includes(next.type.name) ? next : null
}

/** A new, empty first item for the list that starts at `pos`, the same kind
 *  as the items already in it, with the caret on it. */
export function newFirstItem(tr: Transaction, pos: number) {
  const list = tr.doc.nodeAt(pos)!
  tr.insert(pos + 1, list.firstChild!.type.createAndFill()!)
  // Into the list, the new item and its line.
  tr.setSelection(TextSelection.create(tr.doc, pos + 3))
}

/** Enter, at the end of an item's first line, when items are already nested
 *  under it: a new first item of those, level with the ones below. Splitting
 *  the item instead would start one at this level that takes them over. */
export function enterNestedList(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth < 2 || $from.index(-1) !== 0) return false
    if (!$from.parent.isTextblock || $from.pos !== $from.end()) return false
    if (!nestedList($from.node(-1))) return false

    if (dispatch) {
      const tr = state.tr
      newFirstItem(tr, $from.after())
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Backspace, at the start of an empty item nested under another, when more
 *  items follow it: the line goes, and the caret to the end of the line above
 *  — undoing the Enter that made it. Lifting it out a level, as Backspace does
 *  elsewhere, would take the items after it along, nested under it. The last
 *  item still lifts out, the way out of a nested list. */
export function backspaceNestedItem(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth < 4 || !$from.parent.isTextblock || $from.parent.content.size > 0) return false
    const item = $from.node(-1)
    const list = $from.node(-2)
    if (item.type.name !== LIST_ITEM || item.childCount !== 1) return false
    if (!LISTS.includes(list.type.name) || $from.node(-3).type.name !== LIST_ITEM) return false
    if ($from.index(-2) === list.childCount - 1) return false

    if (dispatch) {
      const start = $from.before(-1)
      const tr = state.tr.delete(start, $from.after(-1))
      tr.setSelection(Selection.near(tr.doc.resolve(start), -1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Backspace, on an empty line straight after a list: the line goes, and the
 *  caret to the end of the list's last line.
 *
 *  Tiptap's list keymap does this already, but not where a list item is
 *  further out, as in the box of an accordion heading an item: it takes that
 *  item for the one the caret is in and stands aside. ProseMirror then pulls
 *  the line into the list as a new item, the next Backspace lifts it back out,
 *  and the empty item never goes. */
export function backspaceAfterList(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth < 2 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) return false
    const index = $from.index(-1)
    if (index === 0 || !LISTS.includes($from.node(-1).child(index - 1).type.name)) return false

    if (dispatch) {
      const start = $from.before()
      const tr = state.tr.delete(start, $from.after())
      tr.setSelection(Selection.near(tr.doc.resolve(start), -1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

const enter = enterNestedList()
const nestedBackspace = backspaceNestedItem()
const afterList = backspaceAfterList()
const backspace: Command = (state, dispatch) => nestedBackspace(state, dispatch) || afterList(state, dispatch)

export const ListItem = BaseListItem.extend({
  content,

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () =>
        this.editor.commands.command(({ state, dispatch }) => enter(state, dispatch)) ||
        this.editor.commands.splitListItem(this.name),
      Backspace: () => this.editor.commands.command(({ state, dispatch }) => backspace(state, dispatch)),
    }
  },
})
