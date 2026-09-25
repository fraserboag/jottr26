import { InputRule } from '@tiptap/core'
import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { TextSelection } from '@tiptap/pm/state'

/** StarterKit's divider, but '---' typed on a line of its own with a blank
 *  line already below turns that line into the divider and drops the caret on
 *  the blank one, rather than leaving a second blank line under the rule.
 *  Anywhere else the shortcut does what it always did. */
export const Divider = HorizontalRule.extend({
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
