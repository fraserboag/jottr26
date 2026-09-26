'use client'

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { ToolButton } from '@/components/ui/ToolButton'
import type { IconName } from '@/components/ui/Icon'
import { useOpenPageId } from '@/lib/util/route'
import { linkToNewSubpage } from './subpageLink'

/** The flags both formatting toolbars draw — the bubble on a desktop, the
 *  keyboard bar on a touch screen. Read inside a `useEditorState` selector, so
 *  neither re-renders unless one of them changes. */
export function formatFlags(editor: Editor) {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
    link: editor.isActive('link'),
    heading:
      editor.isActive('heading') ||
      editor.isActive('accordionTitle', { title: true }) ||
      editor.isActive('subpagesTitle', { title: true }),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
  }
}

export type FormatFlags = ReturnType<typeof formatFlags>

/** The link field that takes the toolbar's place while a link is written. */
export function useLinkEditing(editor: Editor) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  // Going back to the page is the end of the link field, however it happened,
  // so the next selection brings up the formatting buttons again.
  useEffect(() => {
    const onFocus = () => setOpen(false)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
    }
  }, [editor])

  const close = () => {
    setOpen(false)
    setValue('')
  }

  return {
    open,
    value,
    start: () => {
      setValue(editor.getAttributes('link').href ?? '')
      setOpen(true)
    },
    close,
    apply: (href: string) => {
      close()
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    },
    clear: () => {
      close()
      editor.chain().focus().unsetLink().run()
    },
  }
}

const MARKS: Array<{ icon: IconName; label: string; flag: keyof FormatFlags; toggle: (editor: Editor) => void }> = [
  { icon: 'bold', label: 'Bold', flag: 'bold', toggle: (editor) => editor.chain().focus().toggleBold().run() },
  { icon: 'italic', label: 'Italic', flag: 'italic', toggle: (editor) => editor.chain().focus().toggleItalic().run() },
  { icon: 'strike', label: 'Strikethrough', flag: 'strike', toggle: (editor) => editor.chain().focus().toggleStrike().run() },
  { icon: 'code', label: 'Inline code', flag: 'code', toggle: (editor) => editor.chain().focus().toggleCode().run() },
]

const BLOCKS: Array<{ icon: IconName; label: string; flag: keyof FormatFlags; toggle: (editor: Editor) => void }> = [
  { icon: 'title', label: 'Title', flag: 'heading', toggle: (editor) => editor.chain().focus().toggleTitle().run() },
  { icon: 'list', label: 'Bulleted list', flag: 'bullet', toggle: (editor) => editor.chain().focus().toggleBulletList().run() },
  { icon: 'listOrdered', label: 'Numbered list', flag: 'ordered', toggle: (editor) => editor.chain().focus().toggleOrderedList().run() },
]

/** The formatting buttons, in the order both toolbars show them. */
export function FormatButtons({
  editor,
  pageId,
  flags,
  onLink,
  separatorClassName,
  selected,
}: {
  editor: Editor
  pageId: string
  flags: FormatFlags
  onLink: () => void
  separatorClassName: string
  /** Given on the keyboard bar, whose buttons show whether or not there is a
   *  selection; the bubble only appears over one. */
  selected?: boolean
}) {
  const [, openPage] = useOpenPageId()
  const touch = selected !== undefined

  return (
    <>
      {MARKS.map((mark) => (
        <ToolButton
          key={mark.flag}
          icon={mark.icon}
          label={mark.label}
          active={flags[mark.flag]}
          onClick={() => mark.toggle(editor)}
        />
      ))}
      <ToolButton
        icon="link"
        label="Link"
        active={flags.link}
        // A link needs some text to sit on: either a selection, or the link
        // the caret is already inside.
        disabled={touch && !selected && !flags.link}
        onClick={onLink}
      />
      <ToolButton
        icon="filePlus"
        label="Link to a new subpage"
        // The new page takes its title from the selection, so there has to be
        // one.
        disabled={touch && !selected}
        onClick={() => linkToNewSubpage(editor, pageId, openPage)}
      />
      <span className={separatorClassName} />
      {BLOCKS.map((block) => (
        <ToolButton
          key={block.flag}
          icon={block.icon}
          label={block.label}
          active={flags[block.flag]}
          onClick={() => block.toggle(editor)}
        />
      ))}
    </>
  )
}
