import { mergeAttributes, Node } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

/** A list of the page's subpages: the pages one level down, each a link.
 *
 *  The node is an empty marker and nothing more. Which pages sit under this one
 *  is page metadata, already synced on its own, so the list is read from the
 *  local database on each device and drawn by a node view. Writing it into the
 *  document would put a copy of that metadata in the CRDT, where two devices
 *  would take turns overwriting a list neither of them typed. It also makes the
 *  block uneditable for free: there is no text in it to edit.
 *
 *  The node view is a React component, so it is attached in the editor rather
 *  than here; this file stays loadable under Node for the tests. */

export interface SubpagesOptions {
  /** The page whose children are listed — the one this editor has open. */
  pageId: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    subpages: {
      /** Put a subpage list where the caret is, and the caret on the line after. */
      insertSubpages: () => ReturnType
    }
  }
}

export const Subpages = Node.create<SubpagesOptions>({
  name: 'subpages',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { pageId: '' }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="subpages"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'subpages' })]
  },

  addCommands() {
    return {
      // The divider's insert, which has already worked out where the caret
      // should land next to a block with no text in it.
      insertSubpages:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true
              const { $to } = tr.selection
              if ($to.nodeAfter?.isTextblock) {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1))
              } else if ($to.nodeAfter?.isBlock) {
                tr.setSelection(NodeSelection.create(tr.doc, $to.pos))
              } else {
                const after = $to.end()
                tr.insert(after, tr.doc.type.schema.nodes.paragraph.create())
                tr.setSelection(TextSelection.create(tr.doc, after + 1))
              }
              tr.scrollIntoView()
              return true
            })
            .run(),
    }
  },
})
