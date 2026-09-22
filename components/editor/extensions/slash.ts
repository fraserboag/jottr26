import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import type { IconName } from '@/components/ui/Icon'

// Type-only, and load-bearing: Tiptap registers its commands through module
// augmentation, so the chainable command types only exist where the extension
// packages are in scope.
import type {} from '@tiptap/starter-kit'
import type {} from '@tiptap/extension-list'
import type {} from '@tiptap/extension-table'

export interface SlashItem {
  id: string
  title: string
  hint: string
  icon: IconName
  keywords: string[]
  /** Hides the item in contexts where it would not make sense. */
  hidden?: (editor: Editor) => boolean
  run: (editor: Editor, range: Range) => void
}

/** Deliberately short. Notion's block menu is long because Notion has a hundred
 *  block types; this app has the ones people actually use in notes. */
export const slashItems: SlashItem[] = [
  {
    id: 'text',
    title: 'Text',
    hint: 'Plain paragraph',
    icon: 'text',
    keywords: ['paragraph', 'body', 'plain'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    hint: 'An unordered list',
    icon: 'list',
    keywords: ['ul', 'unordered', 'point'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: 'Numbered list',
    hint: 'A list with numbers',
    icon: 'listOrdered',
    keywords: ['ol', 'ordered', 'number'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    hint: 'Track things to tick off',
    icon: 'checkSquare',
    keywords: ['task', 'checkbox', 'check'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: 'Set text apart',
    icon: 'quote',
    keywords: ['blockquote', 'cite'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    hint: 'Monospaced, no formatting',
    icon: 'code',
    keywords: ['pre', 'snippet', 'monospace'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'A grid of rows and columns',
    icon: 'table',
    keywords: ['grid', 'row', 'column', 'cell', 'spreadsheet'],
    // Nested tables are a mess to edit and nobody asks for them, so this item
    // is filtered out while the caret is already inside one.
    hidden: (editor) => editor.isActive('table'),
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: 'A horizontal rule',
    icon: 'divider',
    keywords: ['hr', 'rule', 'separator', 'line'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
]

export function filterSlashItems(query: string, editor?: Editor): SlashItem[] {
  const q = query.trim().toLowerCase()
  const available = editor ? slashItems.filter((item) => !item.hidden?.(editor)) : slashItems
  if (!q) return available
  return available.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((keyword) => keyword.startsWith(q)),
  )
}

export interface SlashHandlers {
  onStart: (props: SuggestionProps<SlashItem>) => void
  onUpdate: (props: SuggestionProps<SlashItem>) => void
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
  onExit: () => void
}

/** The menu's look and keyboard handling live in React; this only wires the
 *  ProseMirror suggestion plugin to whatever handlers the component provides. */
export function createSlashExtension(handlers: () => SlashHandlers | null) {
  return Extension.create({
    name: 'slashMenu',

    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: '/',
          startOfLine: false,
          allowSpaces: false,
          // A slash inside a word is a slash, not a command.
          allowedPrefixes: [' ', '\n'],
          items: ({ query, editor }) => filterSlashItems(query, editor),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => handlers()?.onStart(props),
            onUpdate: (props) => handlers()?.onUpdate(props),
            onKeyDown: (props) => handlers()?.onKeyDown(props) ?? false,
            onExit: () => handlers()?.onExit(),
          }),
        }),
      ]
    },
  })
}
