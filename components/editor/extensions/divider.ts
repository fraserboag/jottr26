import { InputRule } from '@tiptap/core'
import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { type Command, type EditorState, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Backspace at the very start of the line under a divider: the divider goes
 *  and the caret stays where it is. ProseMirror would otherwise select the
 *  rule first, as if it were text to be highlighted, and only a second
 *  Backspace would take it. */
export const backspaceAfterDivider: Command = (state, dispatch) => {
  const { selection } = state
  const { $from } = selection
  if (!selection.empty || !$from.parent.isTextblock || $from.parentOffset > 0) return false
  const line = $from.before()
  const rule = state.doc.resolve(line).nodeBefore
  if (rule?.type.name !== 'horizontalRule') return false
  if (dispatch) dispatch(state.tr.delete(line - rule.nodeSize, line).scrollIntoView())
  return true
}

/** Where the caret lands when an arrow key carries it off the top (`dir` -1)
 *  or bottom (1) of its line and the next stop that way is a divider: the
 *  nearest line of text past it, or `null` when there is none. `undefined`
 *  when there is no divider in the way and the arrow should do what it does. */
export function textPastDivider(state: EditorState, dir: -1 | 1): Selection | null | undefined {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty || !selection.$from.depth) return undefined
  const { $from } = selection
  const next = Selection.findFrom(state.doc.resolve(dir > 0 ? $from.after() : $from.before()), dir)
  if (!(next instanceof NodeSelection) || next.node.type.name !== 'horizontalRule') return undefined
  return Selection.findFrom(state.doc.resolve(dir > 0 ? next.to : next.from), dir, true)
}

/** Up or down, over a divider rather than onto it: ProseMirror would select
 *  the rule as a block, like text highlighted, so the caret goes straight to
 *  the line past it, keeping to the column it was in where that line allows.
 *  A divider with no text past it keeps the caret where it is. */
function arrowOverDivider(view: EditorView, dir: -1 | 1) {
  if (!view.endOfTextblock(dir > 0 ? 'down' : 'up')) return false
  const target = textPastDivider(view.state, dir)
  if (target === undefined) return false
  if (target === null) return true

  let pos = target.from
  const { $from } = target
  // The first line of the block below, or the last of the one above.
  const line = view.coordsAtPos(pos)
  const column = view.coordsAtPos(view.state.selection.head).left
  const hit = view.posAtCoords({ left: column, top: (line.top + line.bottom) / 2 })
  if (hit && hit.pos >= $from.start() && hit.pos <= $from.end()) pos = hit.pos
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).scrollIntoView())
  return true
}

/** StarterKit's divider, but '---' typed on a line of its own with a blank
 *  line already below turns that line into the divider and drops the caret on
 *  the blank one, rather than leaving a second blank line under the rule.
 *  Anywhere else the shortcut does what it always did. */
export const Divider = HorizontalRule.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Backspace: () => this.editor.commands.command(({ state, dispatch }) => backspaceAfterDivider(state, dispatch)),
      ArrowUp: () => arrowOverDivider(this.editor.view, -1),
      ArrowDown: () => arrowOverDivider(this.editor.view, 1),
    }
  },

  addInputRules() {
    return (this.parent?.() ?? []).map(
      (rule) =>
        new InputRule({
          find: rule.find,
          handler: (props) => {
            const { state, range } = props
            const $from = state.doc.resolve(range.from)
            const wholeLine = range.from === $from.start() && range.to === $from.end()
            const below = state.doc.nodeAt($from.after())
            const blankBelow = below?.type.name === 'paragraph' && below.content.size === 0
            if (!wholeLine || !blankBelow) return rule.handler(props)

            const { tr } = state
            const line = $from.before()
            tr.replaceWith(line, $from.after(), this.type.create())
            // Past the rule, into the blank line.
            tr.setSelection(TextSelection.create(tr.doc, line + 2))
            tr.scrollIntoView()
          },
        }),
    )
  },
})
