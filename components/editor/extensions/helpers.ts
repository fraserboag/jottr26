import type { Editor } from '@tiptap/core'
import { Fragment, type Node } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'

/** A keyboard shortcut that tries ProseMirror commands in turn, stopping at the
 *  first that takes the key. The commands are built once, by the caller, not
 *  on every press. Run straight against the view rather than through
 *  editor.commands, which dispatches a transaction even when every command
 *  declines — on Enter and Backspace, one per extension that binds them. */
export function pm(editor: Editor, ...commands: Command[]) {
  return () => commands.some((command) => command(editor.state, editor.view.dispatch))
}

export function isEmptyParagraph(node: Node | null | undefined): boolean {
  return node?.type.name === 'paragraph' && node.content.size === 0
}

/** A box holding nothing but one empty line, as a new one does. */
export function isBlankBody(body: Node): boolean {
  return body.childCount === 1 && isEmptyParagraph(body.firstChild)
}

/** A table cell, header or not. */
export function isCellNode(node: Node): boolean {
  const role = node.type.spec.tableRole
  return role === 'cell' || role === 'header_cell'
}

/** Drawn as a Title. A heading that has to stay the node it is — an
 *  accordion's, a subpage list's — can't be swapped for a Title block, so it
 *  carries the style instead. */
export const titleStyleAttribute = {
  default: false,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-title') === 'true',
  renderHTML: (attributes: Record<string, unknown>) => (attributes.title ? { 'data-title': 'true' } : {}),
}

/** A divider straight before `pos` goes, and the caret stays where it is.
 *  False when there is none. */
export function deleteDividerBefore(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pos: number,
) {
  const rule = state.doc.resolve(pos).nodeBefore
  if (rule?.type.name !== 'horizontalRule') return false
  if (dispatch) dispatch(state.tr.delete(pos - rule.nodeSize, pos).scrollIntoView())
  return true
}

/** Up to the end of the line above the block at `pos`, leaving the block
 *  alone. With nothing above to go to, the caret stays put rather than
 *  selecting the block. A divider straight above goes instead, the caret
 *  staying put, as it does under any line. Always takes the key. */
export function caretToLineAbove(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number) {
  if (deleteDividerBefore(state, dispatch, pos)) return true
  const above = Selection.findFrom(state.doc.resolve(pos), -1, true)
  if (above && dispatch) dispatch(state.tr.setSelection(above).scrollIntoView())
  return true
}

/** The block from `pos` to `end` goes, leaving `replacement` in its place, and
 *  the caret goes up to the end of the line above — as Backspace would from
 *  any line there is nothing to join into.
 *
 *  False where it can't: there is no line above, or the page or list item
 *  can't be left without a line here. The caller decides what happens then. */
export function removeBlockToAbove(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pos: number,
  end: number,
  replacement: Node[] = [],
) {
  const $pos = state.doc.resolve(pos)
  const above = Selection.findFrom($pos, -1)
  const index = $pos.index()
  if (!above || !$pos.parent.canReplace(index, index + 1, Fragment.from(replacement))) return false
  if (dispatch) {
    const tr = state.tr.replaceWith(pos, end, replacement)
    tr.setSelection(above.map(tr.doc, tr.mapping))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Backspace at the very start of a block's own heading, the `name` node
 *  that opens it: up to the end of the line above, as Backspace would go from
 *  any line there is nothing to join into. With the heading empty, `emptied`
 *  decides what becomes of the block, which starts at `pos`. */
export function backspaceHeading(
  name: string,
  emptied: (
    state: EditorState,
    dispatch: ((tr: Transaction) => void) | undefined,
    pos: number,
    block: Node,
  ) => boolean,
): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.parent.type.name !== name || $from.parentOffset > 0) return false
    const pos = $from.before(-1)
    if ($from.parent.content.size > 0) return caretToLineAbove(state, dispatch, pos)
    return emptied(state, dispatch, pos, $from.node(-1))
  }
}

/** The caret onto the empty line at `pos`, or onto a new one put there when
 *  the block at `pos` is anything else. */
export function openLineAt(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number) {
  if (dispatch) {
    const tr = state.tr
    if (!isEmptyParagraph(state.doc.nodeAt(pos))) tr.insert(pos, state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** The block from `pos` to `end` becomes one empty line, with the caret on it. */
export function replaceWithEmptyLine(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pos: number,
  end: number,
) {
  if (dispatch) {
    const tr = state.tr.replaceWith(pos, end, state.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}
