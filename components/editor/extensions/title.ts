import { mergeAttributes, Node } from '@tiptap/core'
import { Selection, TextSelection, type Command } from '@tiptap/pm/state'

/** The document's own top node, requiring a title followed by at least one
 *  block. Because the title is node 0 of the same ProseMirror document, it is
 *  part of the Yjs CRDT: renaming a page on two devices merges character by
 *  character like any other text, instead of one rename silently winning. */
export const JottrDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'title block+',
})

/** Enter, in the title: drop into the body on a fresh line of your own.
 *
 *  Naming a page and starting to write are one movement, so Enter has to land
 *  the caret somewhere you can type — not at the head of the first line
 *  already there, where the next word would run into it. A new paragraph opens
 *  at the top of the body and the caret goes in it.
 *
 *  The title cannot be split in two anyway: the schema has exactly one, and it
 *  holds no marks. So this is what Enter means wherever the caret sits in the
 *  title. */
export function openBodyLine(name: string): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth !== 1 || $from.parent.type.name !== name) return false

    const after = $from.after()
    const first = state.doc.maybeChild($from.index(0) + 1)
    const paragraph = state.schema.nodes.paragraph

    // A page that has only ever had its title typed already opens on a blank
    // line. Use that one rather than pushing it down under a second.
    if (first?.type === paragraph && first.content.size === 0) {
      if (dispatch) {
        dispatch(state.tr.setSelection(TextSelection.create(state.doc, after + 1)).scrollIntoView())
      }
      return true
    }

    if (dispatch) {
      const tr = state.tr.insert(after, paragraph.create())
      tr.setSelection(TextSelection.create(tr.doc, after + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Tab, in the title: into the body, leaving the page as it stands.
 *
 *  Tab moves between fields, so it goes to the first line of the body without
 *  writing anything — the difference from Enter, which opens a line to type on. */
export function leaveTitle(name: string): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth !== 1 || $from.parent.type.name !== name) return false

    if (dispatch) {
      const $after = state.doc.resolve($from.after())
      dispatch(state.tr.setSelection(Selection.near($after, 1)).scrollIntoView())
    }
    return true
  }
}

/** Backspace, at the very start of the body: up to the end of the title.
 *
 *  The title is isolating, so nothing joins into it, and ProseMirror would
 *  fall back to selecting the whole title — one more keypress from wiping the
 *  page's name. The caret goes to the end of it instead, as it would to the end
 *  of any line above.
 *
 *  An empty first line with more below is left to ProseMirror, which already
 *  deletes it and puts the caret at the end of the title. */
export function backspaceIntoTitle(name: string): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth !== 1 || !$from.parent.isTextblock || $from.parentOffset !== 0) return false
    if ($from.index(0) !== 1 || state.doc.firstChild?.type.name !== name) return false
    if ($from.parent.content.size === 0 && state.doc.childCount > 2) return false

    if (dispatch) {
      const titleEnd = state.doc.firstChild.nodeSize - 1
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, titleEnd)).scrollIntoView())
    }
    return true
  }
}

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
    const openLine = () =>
      this.editor.commands.command(({ state, dispatch }) => openBodyLine(this.name)(state, dispatch))

    return {
      Enter: openLine,
      'Mod-Enter': openLine,
      Tab: () =>
        this.editor.commands.command(({ state, dispatch }) => leaveTitle(this.name)(state, dispatch)),
      Backspace: () =>
        this.editor.commands.command(({ state, dispatch }) => backspaceIntoTitle(this.name)(state, dispatch)),
    }
  },
})
