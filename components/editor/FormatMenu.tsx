'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { Icon, type IconName } from '@/components/ui/Icon'

export function FormatMenu({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
      h1: instance.isActive('heading', { level: 1 }),
      h2: instance.isActive('heading', { level: 2 }),
      h3: instance.isActive('heading', { level: 3 }),
      bullet: instance.isActive('bulletList'),
      ordered: instance.isActive('orderedList'),
    }),
  })

  useEffect(() => {
    if (linkOpen) inputRef.current?.focus()
  }, [linkOpen])

  const applyLink = () => {
    const href = linkValue.trim()
    setLinkOpen(false)
    setLinkValue('')
    if (!href) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const url = /^https?:\/\//i.test(href) ? href : `https://${href}`
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: instance, from, to }) => {
        if (from === to) return false
        // The title takes no marks, so a toolbar over it would only mislead.
        if (instance.isActive('title')) return false
        return !instance.isActive('codeBlock')
      }}
      className="flex items-center gap-0.5 rounded-lg border border-line bg-raised p-1 shadow-[var(--shadow-pop)]"
    >
      {linkOpen ? (
        <form
          className="flex items-center gap-1 px-1"
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
        >
          <Icon name="link" size={14} className="text-faint" />
          <input
            ref={inputRef}
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setLinkOpen(false)
              }
            }}
            placeholder="Paste a link and press Enter"
            className="w-56 bg-transparent py-1 text-[13px] outline-none placeholder:text-faint"
          />
          <button type="submit" className="rounded px-1.5 py-1 text-[12px] font-medium text-accent">
            Apply
          </button>
        </form>
      ) : (
        <>
          <Tool icon="bold" label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <Tool icon="italic" label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <Tool icon="strike" label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <Tool icon="code" label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />
          <Tool
            icon="link"
            label="Link"
            active={state.link}
            onClick={() => {
              setLinkValue(editor.getAttributes('link').href ?? '')
              setLinkOpen(true)
            }}
          />
          <span className="mx-1 h-5 w-px bg-line" />
          <Tool icon="h1" label="Heading 1" active={state.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
          <Tool icon="h2" label="Heading 2" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <Tool icon="h3" label="Heading 3" active={state.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <span className="mx-1 h-5 w-px bg-line" />
          <Tool icon="list" label="Bulleted list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <Tool icon="listOrdered" label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        </>
      )}
    </BubbleMenu>
  )
}

function Tool({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid size-7 place-items-center rounded-md transition-colors hover:bg-[var(--hover)] ${
        active ? 'text-accent' : 'text-muted'
      }`}
    >
      <Icon name={icon} size={15} strokeWidth={active ? 2.1 : 1.8} />
    </button>
  )
}
