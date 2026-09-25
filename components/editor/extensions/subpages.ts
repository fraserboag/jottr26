import { mergeAttributes, Node } from '@tiptap/core'
import { NodeSelection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

/** A list of the page's subpages: the pages one level down, each a link — or,
 *  set to a depth of two, the pages two levels down, grouped under the child
 *  each one sits in.
 *
 *  The node holds its heading, written like any other line, and that depth: a
 *  setting of this block's, not a copy of anything. Which pages sit under this
 *  one is page metadata, already synced on its own, so the list is read from
 *  the local database on each device and drawn by a node view. Writing it into
 *  the document would put a copy of that metadata in the CRDT, where two
 *  devices would take turns overwriting a list neither of them typed. It also
 *  keeps the list out of reach of typing: the heading is the only text in it.
 *
 *  The node view is a React component, so it is attached in the editor rather
 *  than here; this file stays loadable under Node for the tests. */

export const SUBPAGES = 'subpages'
export const SUBPAGES_TITLE = 'subpagesTitle'
/** What a list's heading says to start with: in bold on a new one, and as a
 *  Title on one written before the heading could be changed, which is how it
 *  was drawn then. */
export const SUBPAGES_DEFAULT_TITLE = 'Subpages'

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

/** Onto the line after the block that ends at `after`: the next line if it is
 *  one to type on, the next block selected if it is not, or a new line if the
 *  page ends there. */
function caretAfter(tr: Transaction, after: number) {
  const $after = tr.doc.resolve(after)
  if ($after.nodeAfter?.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
  } else if ($after.nodeAfter?.isBlock) {
    tr.setSelection(NodeSelection.create(tr.doc, after))
  } else {
    const end = $after.end()
    tr.insert(end, tr.doc.type.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, end + 1))
  }
  return tr.scrollIntoView()
}

/** Enter, in the heading: onto the line below the list. The heading is the
 *  block's only line, so there is nothing to split it into, and the list under
 *  it is not written in. */
export function leaveSubpagesTitle(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.parent.type.name !== SUBPAGES_TITLE) return false
    if (dispatch) dispatch(caretAfter(state.tr, $from.after(-1)))
    return true
  }
}

export const SubpagesTitle = Node.create({
  name: SUBPAGES_TITLE,
  content: 'inline*',
  defining: true,
  // Backspace at its start, or Delete at its end, would otherwise pull text
  // in from the lines around the block, or push this one out to them.
  isolating: true,

  addAttributes() {
    return {
      /** Drawn as a Title, as an accordion's heading can be, and for the same
       *  reason: the list has to hold exactly this node, so it can't become a
       *  Title block. */
      title: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-title') === 'true',
        renderHTML: (attributes) => (attributes.title ? { 'data-title': 'true' } : {}),
      },
    }
  },

  parseHTML() {
    // Ahead of the paragraph's rule, which any p would otherwise match first.
    return [{ tag: 'p.subpages-title', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { class: 'subpages-title' }), 0]
  },
})

export const Subpages = Node.create<SubpagesOptions>({
  name: SUBPAGES,
  group: 'block',
  // Only the heading, so a Title, a list or a code block can't be made of it:
  // each of those would have to replace it with a node this block can't hold.
  // Optional, though it is always written: a copy of the app from before the
  // heading, still open somewhere, deletes one it doesn't know, and a block
  // that had to have it would then be deleted whole, on every device.
  content: `${SUBPAGES_TITLE}?`,
  // Backspace on the line after it selects the block, as it did when there
  // was no text in it, rather than pulling that line up into the heading.
  isolating: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { pageId: '' }
  },

  addAttributes() {
    return {
      depth: {
        default: 1,
        parseHTML: (element) => (element.getAttribute('data-depth') === '2' ? 2 : 1),
        renderHTML: (attributes) => ({ 'data-depth': String(attributes.depth) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="subpages"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': SUBPAGES }), 0]
  },

  addCommands() {
    return {
      // The divider's insert, which has already worked out where the caret
      // should land next to a block with no text in it.
      insertSubpages:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              content: [
                {
                  type: SUBPAGES_TITLE,
                  content: [{ type: 'text', text: SUBPAGES_DEFAULT_TITLE, marks: [{ type: 'bold' }] }],
                },
              ],
            })
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true
              // The insert leaves the caret at the end of the new heading.
              const { $to } = tr.selection
              caretAfter(tr, $to.parent.type.name === SUBPAGES_TITLE ? $to.after(-1) : $to.pos)
              return true
            })
            .run(),
    }
  },

  addKeyboardShortcuts() {
    const leave = leaveSubpagesTitle()
    return {
      Enter: () => this.editor.commands.command(({ state, dispatch }) => leave(state, dispatch)),
    }
  },
})
