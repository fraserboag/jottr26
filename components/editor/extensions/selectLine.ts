import { Extension } from '@tiptap/core'
import { Slice, type Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'

/** The whole page below its title: every block of the body, from the first to
 *  the last, whatever they are — a divider or a table at either end included,
 *  which a text selection could only start or stop inside of. The title is a
 *  field of its own, so selecting everything leaves it out. */
export class BodySelection extends Selection {
  constructor(doc: PMNode) {
    super(doc.resolve(doc.firstChild!.nodeSize), doc.resolve(doc.content.size))
  }

  /** Cleared, the body is one empty line with the caret on it — not nothing,
   *  which would leave the caret up in the title. */
  replace(tr: Transaction, content = Slice.empty) {
    if (content !== Slice.empty) return super.replace(tr, content)
    const start = tr.doc.firstChild!.nodeSize
    tr.replaceWith(start, tr.doc.content.size, tr.doc.type.schema.nodes.paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, start + 1))
  }

  map(doc: PMNode) {
    return new BodySelection(doc)
  }

  eq(other: Selection): boolean {
    return other instanceof BodySelection
  }

  toJSON() {
    return { type: 'body' }
  }

  static fromJSON(doc: PMNode) {
    return new BodySelection(doc)
  }
}

// A module evaluated twice, as a hot reload does, would register it twice,
// which throws.
try {
  Selection.jsonID('body', BodySelection)
} catch {}

/** Mod-A, the first time: the line the caret is on, not the whole page.
 *
 *  Pressed again with that line already selected, it declines, and
 *  `selectBody` takes the rest of the page — so holding Mod and tapping A
 *  twice goes line, then everything. An empty line has nothing to select, and
 *  a selection already running across lines has outgrown one, so both go
 *  straight to the whole page. */
export const selectLine: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return false

  const start = $from.start()
  const end = $from.end()
  if (start === end) return false
  if ($from.pos === start && $to.pos === end) return false

  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)))
  return true
}

/** Mod-A, past the line: all of the body, never the title with it.
 *
 *  With the selection in the title, the title is as far as it goes — it is a
 *  field of its own, and its text is already selected by then. */
export const selectBody: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  const title = state.doc.firstChild!.nodeSize
  if ($to.pos < title) {
    if (dispatch && ($from.pos !== 1 || $to.pos !== title - 1)) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, title - 1)))
    }
    return true
  }
  if (dispatch && !(state.selection instanceof BodySelection)) {
    dispatch(state.tr.setSelection(new BodySelection(state.doc)))
  }
  return true
}

export const SelectLine = Extension.create({
  name: 'selectLine',
  /** Ahead of Tiptap's core keymap, which binds Mod-A to select-all — title
   *  and all — and is never let through. */
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      'Mod-a': () =>
        this.editor.commands.command(
          ({ state, dispatch }) => selectLine(state, dispatch) || selectBody(state, dispatch),
        ),
    }
  },
})
