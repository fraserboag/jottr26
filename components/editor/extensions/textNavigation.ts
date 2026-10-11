import { Extension } from '@tiptap/core'
import { keymap } from '@tiptap/pm/keymap'
import { Selection, TextSelection, type Command, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { textCaretSide } from './textCaret'

type Direction = -1 | 1

/** Without a DOM (or Selection.modify), keep Home/End on the current hard
 *  line, including Shift-Enter breaks and newlines inside a code block. */
function hardLineBoundary(state: EditorState, dir: Direction) {
  const { $head } = state.selection
  const text = $head.parent.textBetween(0, $head.parent.content.size, '', (node) =>
    node.type.name === 'hardBreak' ? '\n' : '\ufffc',
  )
  const offset = $head.parentOffset
  if (dir < 0) return $head.start() + text.slice(0, offset).lastIndexOf('\n') + 1
  const end = text.indexOf('\n', offset)
  return $head.start() + (end < 0 ? text.length : end)
}

/** Let the browser find the visual line edge: document offsets alone cannot
 *  see soft wraps, bidirectional text, or which side of a wrap the caret is on. */
function visualLineBoundary(state: EditorState, view: EditorView | undefined, dir: Direction, extend: boolean) {
  const native = view?.dom?.ownerDocument.getSelection()
  if (!view || !native?.modify || !native.anchorNode || !native.focusNode
    || !view.dom.contains(native.anchorNode) || !view.dom.contains(native.focusNode)) return null
  if (view.posAtDOM(native.focusNode, native.focusOffset) !== state.selection.head) return null

  const { anchorNode, anchorOffset, focusNode, focusOffset } = native
  // WebKit can move the anchor when modify('extend') reverses a selection.
  // Find the edge from a caret at the active end, then put the anchor back.
  if (!native.isCollapsed) native.collapse(focusNode, focusOffset)
  native.modify('move', dir < 0 ? 'backward' : 'forward', 'lineboundary')
  if (!native.focusNode || !view.dom.contains(native.focusNode)) {
    native.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
    return null
  }
  const head = view.posAtDOM(native.focusNode, native.focusOffset)
  const { $head } = state.selection
  if (head < $head.start() || head > $head.end()) {
    native.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
    return null
  }
  if (extend) native.setBaseAndExtent(anchorNode, anchorOffset, native.focusNode, native.focusOffset)
  return head
}

/** Home/End, also emitted by Fn-Left/Right on a Mac, move the caret instead
 *  of scrolling the page. Shift keeps the original selection anchor. */
export function moveToLineBoundary(dir: Direction, extend = false): Command {
  return (state, dispatch, view) => {
    if (!(state.selection instanceof TextSelection) || !state.selection.$head.parent.isTextblock) return false
    if (dispatch) {
      const head = visualLineBoundary(state, view, dir, extend) ?? hardLineBoundary(state, dir)
      const anchor = extend ? state.selection.anchor : head
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, head))
        .setMeta(textCaretSide, dir < 0 ? 1 : -1).scrollIntoView())
    }
    return true
  }
}

/** Use text positions so a divider at the document edge is skipped and a
 *  table at the edge lands in a cell, ready to type. */
export function moveToDocumentBoundary(dir: Direction, extend = false): Command {
  return (state, dispatch) => {
    const edge = state.doc.resolve(dir < 0 ? 0 : state.doc.content.size)
    const target = Selection.findFrom(edge, -dir, true)
    if (!target) return false
    if (dispatch) {
      const anchor = extend && state.selection instanceof TextSelection ? state.selection.anchor : target.head
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, anchor, target.head)).scrollIntoView())
    }
    return true
  }
}

export const TextNavigation = Extension.create({
  name: 'textNavigation',
  priority: 1000,

  addProseMirrorPlugins() {
    return [keymap({
      Home: moveToLineBoundary(-1),
      End: moveToLineBoundary(1),
      'Shift-Home': moveToLineBoundary(-1, true),
      'Shift-End': moveToLineBoundary(1, true),
      'Meta-ArrowLeft': moveToLineBoundary(-1),
      'Meta-ArrowRight': moveToLineBoundary(1),
      'Meta-Shift-ArrowLeft': moveToLineBoundary(-1, true),
      'Meta-Shift-ArrowRight': moveToLineBoundary(1, true),
      'Meta-ArrowUp': moveToDocumentBoundary(-1),
      'Meta-ArrowDown': moveToDocumentBoundary(1),
      'Meta-Shift-ArrowUp': moveToDocumentBoundary(-1, true),
      'Meta-Shift-ArrowDown': moveToDocumentBoundary(1, true),
      'Ctrl-Home': moveToDocumentBoundary(-1),
      'Ctrl-End': moveToDocumentBoundary(1),
      'Ctrl-Shift-Home': moveToDocumentBoundary(-1, true),
      'Ctrl-Shift-End': moveToDocumentBoundary(1, true),
      'Meta-Home': moveToDocumentBoundary(-1),
      'Meta-End': moveToDocumentBoundary(1),
      'Meta-Shift-Home': moveToDocumentBoundary(-1, true),
      'Meta-Shift-End': moveToDocumentBoundary(1, true),
    })]
  },
})
