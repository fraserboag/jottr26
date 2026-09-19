import { mergeAttributes, Node } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'

/** The document's own top node, requiring a title followed by at least one
 *  block. Because the title is node 0 of the same ProseMirror document, it is
 *  part of the Yjs CRDT: renaming a page on two devices merges character by
 *  character like any other text, instead of one rename silently winning. */
export const JottrDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'title block+',
})

export const Title = Node.create({
  name: 'title',
  content: 'inline*',
  /** No marks: a page title is a name, not a place to put bold text. */
  marks: '',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'h1.jottr-title' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['h1', mergeAttributes(HTMLAttributes, { class: 'jottr-title' }), 0]
  },

  addKeyboardShortcuts() {
    const leaveTitle = () => {
      const { state, view } = this.editor
      const { $from, empty } = state.selection
      if (!empty || $from.parent.type.name !== this.name) return false

      const after = $from.after(1)
      if (after >= state.doc.content.size) {
        return this.editor
          .chain()
          .insertContentAt(state.doc.content.size, { type: 'paragraph' })
          .focus('end')
          .run()
      }

      view.dispatch(
        state.tr.setSelection(Selection.near(state.doc.resolve(after), 1)).scrollIntoView(),
      )
      return true
    }

    return {
      // Enter in the title moves into the body rather than splitting the title
      // in two, which the schema would not allow anyway.
      Enter: leaveTitle,
      'Mod-Enter': leaveTitle,
      Tab: leaveTitle,
    }
  },
})
