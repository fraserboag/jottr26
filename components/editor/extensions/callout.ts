import { mergeAttributes, Node } from '@tiptap/core'

/** A callout: a padded box that sets a passage apart from the page around it.
 *
 *  It wraps blocks rather than holding inline content of its own, so a callout
 *  can carry a heading, a list or several paragraphs — the same deal a
 *  blockquote offers, with a background instead of a rule down the side.
 *
 *  No attributes, on purpose. There is nothing here to pick a colour or an icon
 *  for, so there is nothing for two devices to disagree about: the node rides
 *  the CRDT as plain structure, and a callout typed on a phone is the same
 *  callout on a laptop. */

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
})
