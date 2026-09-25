import { Extension } from '@tiptap/core'
import { TextSelection, type Command } from '@tiptap/pm/state'

/** Mod-A, the first time: the line the caret is on, not the whole page.
 *
 *  Pressed again with that line already selected, it declines, and the
 *  editor's own select-all takes the rest of the page — so holding Mod and
 *  tapping A twice goes line, then everything. An empty line has nothing to
 *  select, and a selection already running across lines has outgrown one, so
 *  both go straight to the whole page. */
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

export const SelectLine = Extension.create({
  name: 'selectLine',
  /** Ahead of Tiptap's core keymap, which binds Mod-A to select-all. */
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      'Mod-a': () => this.editor.commands.command(({ state, dispatch }) => selectLine(state, dispatch)),
    }
  },
})
