import { createChainableState, type Editor } from '@tiptap/core'
import { ListItem as BaseListItem } from '@tiptap/extension-list'
import { Fragment, Slice, type Node } from '@tiptap/pm/model'
import { TextSelection, type Command, type Transaction } from '@tiptap/pm/state'
import { sinkListItem } from '@tiptap/pm/schema-list'
import { canJoin, ReplaceAroundStep } from '@tiptap/pm/transform'
import { pm, removeBlockToAbove } from './helpers'

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
 *  item still lifts out, the way out of a nested list.
 *
 *  A list in an accordion's box counts as nested too, and there every item
 *  below the first goes the same way, the last included: lifted out, it would
 *  only leave a bare line in the box for a second Backspace to take. */
export function backspaceNestedItem(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth < 4 || !$from.parent.isTextblock || $from.parent.content.size > 0) return false
    const item = $from.node(-1)
    const list = $from.node(-2)
    if (item.type.name !== LIST_ITEM || item.childCount !== 1 || !LISTS.includes(list.type.name)) return false
    const index = $from.index(-2)
    const holder = $from.node(-3).type.name
    if (holder === 'accordionBody') {
      if (index === 0) return false
    } else if (holder !== LIST_ITEM || index === list.childCount - 1) {
      return false
    }

    return removeBlockToAbove(state, dispatch, $from.before(-1), $from.after(-1))
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

    return removeBlockToAbove(state, dispatch, $from.before(), $from.after())
  }
}

/** Adjacent lists of the same kind read as one continuous outline, but the
 *  stock sink stops at their boundary. Join that boundary before sinking
 *  the selected items under the last item above, in one transaction. */
export function sinkAcrossAdjacentLists(): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const item = state.schema.nodes[LIST_ITEM]
    const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === item)
    if (!range || range.startIndex !== 0 || !LISTS.includes(range.parent.type.name)) return false
    const before = $from.before(range.depth)
    const previous = state.doc.resolve(before).nodeBefore
    if (previous?.type !== range.parent.type || previous.lastChild?.type !== item || !canJoin(state.doc, before)) return false

    const tr = state.tr.join(before)
    const joined = createChainableState({ state, transaction: tr })
    return sinkListItem(item)(joined, dispatch)
  }
}

/** Tab, over several items starting at the first of their list: the rest go
 *  under that first one, which has no item above it to go under itself.
 *  Tiptap's sink takes the items as a block and, finding no room for the
 *  first, turns the key down for all of them, and the browser then moves
 *  focus out of the page. Anywhere else it nests every selected item already. */
export function sinkFromFirstItem(): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const item = state.schema.nodes[LIST_ITEM]
    const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === item)
    if (!range || range.startIndex !== 0 || range.endIndex - range.startIndex < 2) return false
    const { parent } = range
    const first = parent.child(0)
    if (first.type !== item) return false

    if (dispatch) {
      // As Tiptap's sink does it, from the second item on: the items are
      // wrapped in a list of their own and taken into the first, joining
      // any list already nested under it.
      const nested = first.lastChild!.type === parent.type
      const slice = new Slice(
        Fragment.from(item.create(null, Fragment.from(parent.type.create(null, nested ? item.create() : null)))),
        nested ? 3 : 1,
        0,
      )
      const before = range.start + first.nodeSize
      const after = range.end
      const step = new ReplaceAroundStep(before - (nested ? 3 : 1), after, before, after, slice, 1, true)
      dispatch(state.tr.step(step).scrollIntoView())
    }
    return true
  }
}

/** Whether the selection starts inside a list item. Tab and Shift-Tab there
 *  are the list's even when the item can go no further in or out — the first
 *  item of a list, with nothing above to go under — rather than falling
 *  through to the browser, which moves focus out of the page. */
function inListItem(editor: Editor) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === LIST_ITEM) return true
  }
  return false
}

export const ListItem = BaseListItem.extend({
  content,

  addKeyboardShortcuts() {
    const enter = pm(this.editor, enterNestedList())
    const tab = pm(this.editor, sinkAcrossAdjacentLists(), sinkFromFirstItem())
    // Asked first, since editor.commands dispatches even when the command
    // declines, and outside a list these decline on every press.
    const { editor, name } = this
    return {
      Enter: () => enter() || (editor.can().splitListItem(name) && editor.commands.splitListItem(name)),
      Tab: () => tab() || (editor.can().sinkListItem(name) && editor.commands.sinkListItem(name)) || inListItem(editor),
      'Shift-Tab': () => (editor.can().liftListItem(name) && editor.commands.liftListItem(name)) || inListItem(editor),
      Backspace: pm(this.editor, backspaceNestedItem(), backspaceAfterList()),
    }
  },
})
