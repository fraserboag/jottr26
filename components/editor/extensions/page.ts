import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { AccordionKit } from './accordion'
import { Callout } from './callout'
import { CodeBlockExit } from './codeBlock'
import { Divider } from './divider'
import { FinanceTable } from './finance'
import { Heading } from './heading'
import { ListItem } from './lists'
import { FormattingMarks } from './marks'
import { SelectBlock } from './selectBlock'
import { SelectLine } from './selectLine'
import { Subpages, SubpagesTitle } from './subpages'
import { ScrollingTableView } from './tableView'
import { JottrDocument, Title } from './title'

/** Every block and mark a page can hold, with the keys that go with them, in
 *  the order the editor installs them. Their shortcuts are tried the other way
 *  round: Tiptap reverses the list before sorting it by priority, so for the
 *  same key an extension further down gets it first.
 *
 *  Loadable under Node, so the tests build their schema from this same list
 *  rather than from a copy of it. What needs a browser or a live document —
 *  Yjs, placeholders, the slash menu, the subpage list's React view — the
 *  editor adds on top, and passes its own `subpages` in with the view on it. */
export function pageExtensions({ subpages = Subpages }: { subpages?: AnyExtension } = {}): AnyExtension[] {
  return [
    JottrDocument,
    Title,
    StarterKit.configure({
      document: false,
      // Collaboration brings its own Yjs-aware undo stack. Keeping
      // ProseMirror's would undo other devices' edits along with yours.
      undoRedo: false,
      // StarterKit brings Heading unless this is exactly false. Its six
      // levels give way to the one-size Heading added below.
      heading: false,
      // Same again for Blockquote: without this, '>' and Mod-Shift-B still
      // make quotes. A callout is the block that sets a passage apart, and
      // '>' opens an accordion instead.
      blockquote: false,
      // Added below instead, as a version whose first line can be an
      // accordion.
      listItem: false,
      // Added below instead, as versions a new line doesn't carry over.
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } },
      // Enter's way out is CodeBlockExit's, below, rather than Tiptap's
      // two blank lines.
      codeBlock: { HTMLAttributes: { spellcheck: 'false' }, exitOnTripleEnter: false },
      // Added below instead, as a version whose '---' reuses a blank line
      // already under it.
      horizontalRule: false,
      // The accent, like every other drop line and resize handle, rather
      // than the text colour it defaults to.
      dropcursor: { color: 'var(--accent)' },
    }),
    ...FormattingMarks,
    Heading,
    SelectLine,
    SelectBlock,
    ListItem,
    Callout,
    CodeBlockExit,
    Divider,
    subpages,
    SubpagesTitle,
    ...AccordionKit,
    // Rows, cells and headers come from the kit; the table node itself is
    // the finance-aware one, so its extra attribute and plugin are in the
    // schema from the start.
    TableKit.configure({ table: false }),
    FinanceTable.configure({
      resizable: true,
      // Dragging a line trades width between the two columns either side
      // of it (see tableResize.ts), and never takes away a table's last
      // unsized column, so the table keeps filling the page. This is the
      // floor a drag stops at; the columns nobody dragged stop shrinking
      // sooner, and the table scrolls.
      cellMinWidth: 40,
      // The table's own edges are not lines between columns.
      lastColumnResizable: false,
      View: ScrollingTableView,
      // Only reaches serialised HTML: while the editor is editable the
      // resizing plugin renders the table through TableView, which brings
      // the wrapper the sideways scroll hangs off.
      renderWrapper: true,
    }),
  ]
}
