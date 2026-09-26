import { isNodeActive, Node, textblockTypeInputRule } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { ACCORDION_TITLE } from './accordion'
import { SUBPAGES_TITLE } from './subpages'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    titleBlock: {
      /** The selected lines between Title and text. In an accordion's or a
       *  subpage list's heading, which has to stay that node, its Title style
       *  instead. */
      toggleTitle: () => ReturnType
      /** The line as a Title, as the slash menu makes it — or, in a heading
       *  that has to stay the node it is, that heading's Title style. */
      setTitle: () => ReturnType
    }
  }
}

/** The heading the caret is in that has to stay the node it is, if any. Read
 *  from the command's own state, which a chain has moved on from the editor's. */
function ownHeading(state: EditorState) {
  return [ACCORDION_TITLE, SUBPAGES_TITLE].find((name) => state.schema.nodes[name] && isNodeActive(state, name))
}

/** A title inside the page body: one size only, a step up from body text.
 *
 *  Not StarterKit's Heading, which stays switched off. That one carries a level
 *  for h1 to h6, and six sizes is exactly what this editor doesn't want. This
 *  node has no attributes, so every markdown shortcut from '#' to '######'
 *  lands on the same block, and a pasted h1 to h6 does too — bar the page's
 *  own title, which is an h1 of its own. */
export const Heading = Node.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [
      { tag: 'h1:not(.jottr-title)' },
      { tag: 'h2' },
      { tag: 'h3' },
      { tag: 'h4' },
      { tag: 'h5' },
      { tag: 'h6' },
    ]
  },

  // An h2: the page title is the page's h1.
  renderHTML({ HTMLAttributes }) {
    return ['h2', HTMLAttributes, 0]
  },

  addCommands() {
    return {
      toggleTitle:
        () =>
        ({ state, commands }) => {
          const own = ownHeading(state)
          return own
            ? commands.updateAttributes(own, { title: !isNodeActive(state, own, { title: true }) })
            : commands.toggleNode(this.name, 'paragraph')
        },
      setTitle:
        () =>
        ({ state, commands }) => {
          const own = ownHeading(state)
          return own ? commands.updateAttributes(own, { title: true }) : commands.setNode(this.name)
        },
    }
  },

  addInputRules() {
    return [textblockTypeInputRule({ find: /^#{1,6}\s$/, type: this.type })]
  },
})
