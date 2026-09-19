import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import type { IconName } from '@/components/ui/Icon'

// Type-only, and load-bearing: Tiptap registers its commands through module
// augmentation, so the chainable command types only exist where the extension
// packages are in scope.
import type {} from '@tiptap/starter-kit'
import type {} from '@tiptap/extension-list'

export interface SlashItem {
  id: string
  title: string
  hint: string
  icon: IconName
  keywords: string[]
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
    id: 'h1',
    title: 'Heading 1',
    hint: 'Big section heading',
    icon: 'h1',
    keywords: ['title', 'large', 'h1'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: 'Medium section heading',
    icon: 'h2',
    keywords: ['subtitle', 'h2'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: 'Small section heading',
    icon: 'h3',
    keywords: ['h3', 'minor'],
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
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
    id: 'divider',
    title: 'Divider',
    hint: 'A horizontal rule',
    icon: 'divider',
    keywords: ['hr', 'rule', 'separator', 'line'],
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return slashItems
  return slashItems.filter(
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
          items: ({ query }) => filterSlashItems(query),
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
