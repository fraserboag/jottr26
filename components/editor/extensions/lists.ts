import { ListItem as BaseListItem, TaskItem as BaseTaskItem } from '@tiptap/extension-list'
import type { Node } from '@tiptap/pm/model'
import { TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

/** List items whose first line can be an accordion as well as a paragraph.
 *
 *  Paragraph comes first in the choice: that is what a new item is filled
 *  with, so Enter and Tab keep making plain bullets. */
const content = '(paragraph | accordion) block*'

const LIST_ITEMS = ['listItem', 'taskItem']
const LISTS = ['bulletList', 'orderedList', 'taskList']

/** The list nested straight under an item's first line, if it has one. */
export function nestedList(item: Node) {
  if (!LIST_ITEMS.includes(item.type.name)) return null
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

const enter = enterNestedList()

export const ListItem = BaseListItem.extend({
  content,

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () =>
        this.editor.commands.command(({ state, dispatch }) => enter(state, dispatch)) ||
        this.editor.commands.splitListItem(this.name),
    }
  },
})

export const TaskItem = BaseTaskItem.extend({
  content,

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () =>
        this.editor.commands.command(({ state, dispatch }) => enter(state, dispatch)) ||
        this.editor.commands.splitListItem(this.name),
    }
  },
}).configure({ nested: true })
