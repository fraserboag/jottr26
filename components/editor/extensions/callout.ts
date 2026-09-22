import { mergeAttributes, Node } from '@tiptap/core'
import { liftEmptyBlock, splitBlock } from '@tiptap/pm/commands'
import { TextSelection, type Command } from '@tiptap/pm/state'
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

/** Enter, inside a callout: leave the box and carry on below it.
 *
 *  A callout is allowed to be the last block on a page, so there has to be a
 *  key that gets you underneath one — otherwise a box at the foot of a page is
 *  the end of that page for good. Enter is that key, and it is the same key
 *  wherever the caret is in the box, so there is nothing to learn: the line you
 *  are on stays where it is, and a new paragraph opens after the callout.
 *
 *  Only for a paragraph the callout holds directly. Inside a list in a callout
 *  Enter still means 'next item', which is what the list's own binding does
 *  with it once this declines. */
export function leaveCallout(name: string): Command {
  return (state, dispatch) => {
    const $from = insideCallout(state.selection.$from, name)
    if (!$from || !state.selection.empty) return false

    // An empty line at the end of the box: lift that line out rather than
    // leaving it behind as a blank row inside. A box whose only line this was
    // goes with it, which is the way out of one opened by accident.
    if ($from.parent.content.size === 0 && $from.after() === $from.end(-1)) {
      return liftEmptyBlock(state, dispatch)
    }

    const after = $from.after(-1)
    const paragraph = state.schema.nodes.paragraph
    const $after = state.doc.resolve(after)
    // A callout can sit inside a list item or a table cell, and not every
    // parent takes a loose paragraph. Where one is refused, Enter is left to
    // whatever would have handled it.
    if (!$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return false

    if (dispatch) {
      const tr = state.tr.insert(after, paragraph.create())
      tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Shift-Enter, inside a callout: a new line that stays in the box.
 *
 *  What Enter does everywhere else, since in here Enter is busy leaving. */
export function newLineInCallout(name: string): Command {
  return (state, dispatch) => {
    const $from = insideCallout(state.selection.$from, name)
    if (!$from || !state.selection.empty) return false
    return splitBlock(state, dispatch)
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
      // Ahead of the hard break Shift-Enter means elsewhere: a callout holds
      // blocks, so a line inside one is a paragraph like any other.
      'Shift-Enter': () =>
        this.editor.commands.command(({ state, dispatch }) =>
          newLineInCallout(this.name)(state, dispatch),
        ),
    }
  },
})
