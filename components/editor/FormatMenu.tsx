'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { useEditorState } from '@tiptap/react'
import { ToolButton } from '@/components/ui/ToolButton'
import { useOpenPageId } from '@/lib/util/route'
import { LinkPicker } from './LinkPicker'
import { linkToNewSubpage } from './subpageLink'

export function FormatMenu({ editor, pageId }: { editor: Editor; pageId: string }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [, openPage] = useOpenPageId()

  // v3 does not re-render on every transaction by default, which is what keeps
  // typing cheap; this subscribes to just the flags the toolbar draws.
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      strike: instance.isActive('strike'),
      code: instance.isActive('code'),
      link: instance.isActive('link'),
      heading:
        instance.isActive('heading') ||
        instance.isActive('accordionTitle', { title: true }) ||
        instance.isActive('subpagesTitle', { title: true }),
      bullet: instance.isActive('bulletList'),
      ordered: instance.isActive('orderedList'),
    }),
  })

  // Going back to the page is the end of the link field, however it happened,
  // so the next selection brings up the formatting buttons again.
  useEffect(() => {
    const onFocus = () => setLinkOpen(false)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
    }
  }, [editor])

  const applyLink = (href: string) => {
    setLinkOpen(false)
    setLinkValue('')
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  const clearLink = () => {
    setLinkOpen(false)
    setLinkValue('')
    editor.chain().focus().unsetLink().run()
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: instance, from, to }) => {
        if (from === to) return false
        // The title takes no marks, so a toolbar over it would only mislead.
        if (instance.isActive('title')) return false
        // Whole cells selected is a table gesture, not a text one; the table
        // toolbar is already showing for it.
        if (instance.state.selection instanceof CellSelection) return false
        // A block selected whole, to be deleted or moved, is not text to
        // format; the text inside it is, selected on its own.
        if (instance.state.selection instanceof NodeSelection) return false
        return !instance.isActive('codeBlock')
      }}
      className="flex items-center gap-1 rounded-xl border border-line bg-raised p-1 shadow-[var(--shadow-pop)] pop-in"
    >
      {linkOpen ? (
        <LinkPicker
          initialHref={linkValue}
          onApply={applyLink}
          onUnset={clearLink}
          onClose={() => setLinkOpen(false)}
        />
      ) : (
        <>
          <ToolButton icon="bold" label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolButton icon="italic" label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolButton icon="strike" label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <ToolButton icon="code" label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />
          <ToolButton
            icon="link"
            label="Link"
            active={state.link}
            onClick={() => {
              setLinkValue(editor.getAttributes('link').href ?? '')
              setLinkOpen(true)
            }}
          />
          <ToolButton icon="filePlus" label="Link to a new subpage" onClick={() => linkToNewSubpage(editor, pageId, openPage)} />
          <span className="mx-1 h-6 w-px bg-line" />
          <ToolButton
            icon="title"
            label="Title"
            active={state.heading}
            onClick={() => editor.chain().focus().toggleTitle().run()}
          />
          <ToolButton icon="list" label="Bulleted list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolButton icon="listOrdered" label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        </>
      )}
    </BubbleMenu>
  )
}
