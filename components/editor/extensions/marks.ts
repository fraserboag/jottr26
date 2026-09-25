import { Bold } from '@tiptap/extension-bold'
import { Code } from '@tiptap/extension-code'
import { Italic } from '@tiptap/extension-italic'
import { Strike } from '@tiptap/extension-strike'
import { Underline } from '@tiptap/extension-underline'
import { codeEdgePlugin, codeEdgeShortcuts } from './codeEdges'

/** Inline code with a caret stop on both sides of each edge (see codeEdges).
 *  That replaces Tiptap's own way out of code at the end of a line, which was
 *  to type a space for you. */
const InlineCode = Code.extend({
  exitable: false,
  addKeyboardShortcuts() {
    return { ...this.parent?.(), ...codeEdgeShortcuts(this.editor, this.type) }
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), codeEdgePlugin(this.type)]
  },
})

/** Bold, italic, underline, strikethrough and inline code, as StarterKit has
 *  them — except that Enter leaves them behind.
 *
 *  Tiptap carries whatever you were typing in onto the new line, so a bold
 *  sentence runs on into a bold paragraph nobody asked for. A new line starts
 *  plain, the way a link already does; turning the style back on is one
 *  keystroke, and noticing it never switched off is a paragraph too late. */
export const FormattingMarks = [Bold, Italic, Underline, Strike, InlineCode].map((mark) =>
  mark.extend({ keepOnSplit: false }),
)
