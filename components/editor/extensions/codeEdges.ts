import type { Editor } from '@tiptap/core'
import type { MarkType, ResolvedPos } from '@tiptap/pm/model'
import { type EditorState, Plugin, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** Two caret stops at each edge of inline code: just inside it and just
 *  outside it.
 *
 *  ProseMirror gives an edge one position, and which side of it you type on
 *  falls out of mark inclusivity — outside at the start, inside at the end.
 *  So the first character of a code span could only be reached by typing
 *  after it, and text after a span at the end of a line couldn't be started
 *  at all. Here the arrows stop twice at each edge, a click on the code's own
 *  padding lands inside it, and a drawn caret shows which side you're on.
 *
 *  The side is held as the selection's stored marks, which typing already
 *  honours, so nothing downstream needs to know about any of this. */

interface Edge {
  $pos: ResolvedPos
  /** Code sits before the caret, so this is the span's end. */
  codeBefore: boolean
  inside: boolean
}

function edgeAt(state: EditorState, type: MarkType, pos = state.selection.head): Edge | null {
  const $pos = state.doc.resolve(pos)
  if (!$pos.parent.inlineContent) return null
  const codeBefore = !!type.isInSet($pos.nodeBefore?.marks ?? [])
  const codeAfter = !!type.isInSet($pos.nodeAfter?.marks ?? [])
  if (codeBefore === codeAfter) return null
  const marks = pos === state.selection.head ? (state.storedMarks ?? $pos.marks()) : $pos.marks()
  return { $pos, codeBefore, inside: !!type.isInSet(marks) }
}

function marksFor(edge: Edge, type: MarkType, inside: boolean) {
  return inside ? [type.create()] : type.removeFromSet(edge.$pos.marks())
}

/** Left or right by one caret stop, or false to let the arrow move as usual. */
export function codeEdgeStep(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  type: MarkType,
  dir: -1 | 1,
) {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  // On an edge, facing across it: cross it without moving.
  const here = edgeAt(state, type)
  if (here) {
    // The side nearer the arrow is the one code is on when it points at code.
    const codeAhead = dir < 0 ? here.codeBefore : !here.codeBefore
    if (here.inside !== codeAhead) {
      dispatch(state.tr.setStoredMarks(marksFor(here, type, codeAhead)))
      return true
    }
  }

  // One character short of an edge: land on the near side of it, the side
  // the caret is coming from, rather than wherever inclusivity puts it.
  const target = selection.head + dir
  const $head = selection.$head
  if (target < $head.start() || target > $head.end()) return false
  const there = edgeAt(state, type, target)
  if (!there) return false
  const codeBehind = dir < 0 ? !there.codeBefore : there.codeBefore
  const tr = state.tr.setSelection(TextSelection.create(state.doc, target))
  dispatch(tr.setStoredMarks(marksFor(there, type, codeBehind)).scrollIntoView())
  return true
}

export function codeEdgeShortcuts(editor: Editor, type: MarkType) {
  return {
    ArrowLeft: () => codeEdgeStep(editor.state, editor.view.dispatch, type, -1),
    ArrowRight: () => codeEdgeStep(editor.state, editor.view.dispatch, type, 1),
  }
}

export function codeEdgePlugin(type: MarkType) {
  return new Plugin({
    props: {
      // A click on the edge goes to whichever side was clicked: the code's own
      // padding counts as inside it.
      handleClick(view, pos, event) {
        if (event.shiftKey) return false
        const edge = edgeAt(view.state, type, pos)
        if (!edge) return false
        const target = event.target instanceof Element ? event.target : null
        const inside = !!target?.closest('code')
        const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))
        view.dispatch(tr.setStoredMarks(marksFor(edge, type, inside)))
        return true
      },

      // The browser's own caret can't be told which side of the edge to sit,
      // so on an edge it's hidden and one is drawn on the right side instead.
      decorations(state) {
        const { selection } = state
        if (!selection.empty) return null
        const edge = edgeAt(state, type)
        if (!edge) return null
        // Just outside the start, the caret sits against the code's border
        // and has to hang the other way to stay clear of it.
        const beforeCode = !edge.inside && !edge.codeBefore
        const caret = Decoration.widget(
          selection.head,
          () => {
            const el = document.createElement('span')
            el.className = beforeCode ? 'code-caret code-caret-before' : 'code-caret'
            return el
          },
          {
            key: edge.inside ? 'code-caret-in' : beforeCode ? 'code-caret-before' : 'code-caret-after',
            marks: edge.inside ? [type.create()] : [],
            side: edge.inside === edge.codeBefore ? -1 : 1,
            ignoreSelection: true,
          },
        )
        return DecorationSet.create(state.doc, [caret])
      },

      attributes(state): Record<string, string> {
        return state.selection.empty && edgeAt(state, type) ? { class: 'on-code-edge' } : {}
      },
    },
  })
}
