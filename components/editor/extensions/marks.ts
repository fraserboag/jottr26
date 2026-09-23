import { Bold } from '@tiptap/extension-bold'
import { Code } from '@tiptap/extension-code'
import { Italic } from '@tiptap/extension-italic'
import { Strike } from '@tiptap/extension-strike'
import { Underline } from '@tiptap/extension-underline'

/** Bold, italic, underline, strikethrough and inline code, as StarterKit has
 *  them — except that Enter leaves them behind.
 *
 *  Tiptap carries whatever you were typing in onto the new line, so a bold
 *  sentence runs on into a bold paragraph nobody asked for. A new line starts
 *  plain, the way a link already does; turning the style back on is one
 *  keystroke, and noticing it never switched off is a paragraph too late. */
export const FormattingMarks = [Bold, Italic, Underline, Strike, Code].map((mark) =>
  mark.extend({ keepOnSplit: false }),
)
