import { mergeAttributes, Node } from '@tiptap/core'
import { liftEmptyBlock } from '@tiptap/pm/commands'
import type { Command } from '@tiptap/pm/state'
import type { ResolvedPos } from '@tiptap/pm/model'

/** A callout: a padded box that sets a passage apart from the page around it.
 *
 *  It wraps blocks rather than holding inline content of its own, so a callout
 *  can carry a list, a code block or several paragraphs, and it is the only
 *  block here that sets a passage apart — the editor has no blockquote.
 *
 *  No attributes, on purpose. There is nothing here to pick a colour or an icon
 *  for, so there is nothing for two devices to disagree about: the node rides
 *  the CRDT as plain structure, and a callout typed on a phone is the same
 *  callout on a laptop. */

/** Enter, on an empty last line of a callout: out of the box, onto a new line
 *  below it.
 *
 *  Everywhere else in the box Enter is a new line inside it, as it is in an
 *  accordion's box and at the end of a list: Enter carries on, and Enter on a
 *  blank line gets you out. That needs no Shift, which a phone keyboard does
 *  not have, and it still gets you underneath a callout at the foot of a page.
 *
 *  The blank line goes with you rather than staying behind as an empty row. A
 *  box whose only line this was goes too, which is the way out of one opened
 *  by accident.
 *
 *  Only for a paragraph the callout holds directly. Inside a list in a callout
 *  Enter still means 'next item', which is what the list's own binding does
 *  with it once this declines. */
export function leaveCallout(name: string): Command {
  return (state, dispatch) => {
    const $from = insideCallout(state.selection.$from, name)
    if (!$from || !state.selection.empty) return false
    if ($from.parent.content.size > 0 || $from.after() !== $from.end(-1)) return false
    return liftEmptyBlock(state, dispatch)
  }
}

/** The position, if it sits in a paragraph the named node holds directly. */
function insideCallout($from: ResolvedPos, name: string) {
  if ($from.depth < 2 || $from.parent.type.name !== 'paragraph') return null
  return $from.node(-1).type.name === name ? $from : null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selected blocks in a callout. */
      setCallout: () => ReturnType
      /** Wrap the selection, or unwrap it if it is already in a callout. */
      toggleCallout: () => ReturnType
      /** Lift the selection back out of its callout. */
      unsetCallout: () => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  /** Pasting into a callout replaces the blocks inside it rather than
   *  dissolving the box around them. */
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: () =>
        this.editor.commands.command(({ state, dispatch }) => leaveCallout(this.name)(state, dispatch)),
    }
  },
})
