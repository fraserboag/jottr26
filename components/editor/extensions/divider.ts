import { InputRule } from '@tiptap/core'
import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { type Command, TextSelection } from '@tiptap/pm/state'

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

/** StarterKit's divider, but '---' typed on a line of its own with a blank
 *  line already below turns that line into the divider and drops the caret on
 *  the blank one, rather than leaving a second blank line under the rule.
 *  Anywhere else the shortcut does what it always did. */
export const Divider = HorizontalRule.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Backspace: () => this.editor.commands.command(({ state, dispatch }) => backspaceAfterDivider(state, dispatch)),
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
