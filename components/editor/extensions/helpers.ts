import type { Editor } from '@tiptap/core'
import { Fragment, type Node } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'

/** A keyboard shortcut that tries ProseMirror commands in turn, stopping at the
 *  first that takes the key. The commands are built once, by the caller, not
 *  on every press. */
export function pm(editor: Editor, ...commands: Command[]) {
  return () =>
    editor.commands.command(({ state, dispatch }) => commands.some((command) => command(state, dispatch)))
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

/** Up to the end of the line above the block at `pos`, leaving the block
 *  alone. With nothing above to go to, the caret stays put rather than
 *  selecting the block. Always takes the key. */
export function caretToLineAbove(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number) {
  const above = Selection.findFrom(state.doc.resolve(pos), -1)
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
