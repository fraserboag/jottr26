import { Extension } from '@tiptap/core'
import { type Command, TextSelection } from '@tiptap/pm/state'

/** Enter, on an empty last line of a code block: out of the block, onto a new
 *  line below it — the same way out as a callout's.
 *
 *  Everywhere else in the block Enter is a new line inside it. Tiptap's own
 *  rule wants two blank lines at the end before it lets you go, which is one
 *  Enter more than a callout, an accordion or a list asks for.
 *
 *  The blank line goes with you rather than staying behind as an empty row at
 *  the foot of the code. A block that was never written in goes too, turning
 *  back into the plain line it was opened from. */
export const leaveCodeBlock: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.type.spec.code) return false
  const code = $from.parent
  if ($from.parentOffset !== code.content.size) return false
  const paragraph = state.schema.nodes.paragraph

  if (code.content.size === 0) {
    if (!$from.node(-1).canReplaceWith($from.index(-1), $from.index(-1) + 1, paragraph)) return false
    if (dispatch) dispatch(state.tr.setBlockType($from.pos, $from.pos, paragraph).scrollIntoView())
    return true
  }

  if (!code.textContent.endsWith('\n')) return false
  const after = $from.indexAfter(-1)
  if (!$from.node(-1).canReplaceWith(after, after, paragraph)) return false
  if (dispatch) {
    const tr = state.tr.delete($from.pos - 1, $from.pos)
    const below = tr.mapping.map($from.after())
    tr.insert(below, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, below + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const CodeBlockExit = Extension.create({
  name: 'codeBlockExit',

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.command(({ state, dispatch }) => leaveCodeBlock(state, dispatch)),
    }
  },
})
