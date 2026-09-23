'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { ToolButton } from '@/components/ui/ToolButton'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useAllPages } from '@/lib/db/hooks'
import { LinkPicker } from './LinkPicker'

/** The format menu for touch screens: the same actions as the bubble, on a bar
 *  that sits on top of the keyboard for as long as the page is being edited.
 *
 *  A bubble over the selection fights the phone for the same few pixels — the
 *  system's own copy and paste callout draws there too — and it only appears
 *  once text is selected, which on glass means dragging handles about first.
 *  Here the bar is always in reach, so formatting works the way it does in any
 *  notes app: select and tap, or tap and then type. */
export function MobileToolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const { userId } = useWorkspace()
  const pages = useAllPages(userId)
  const barRef = useRef<HTMLDivElement>(null)

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      focused: instance.isFocused,
      // The same places the bubble stays away from: the title takes no marks,
      // and a code block takes none either.
      hidden: instance.isActive('title') || instance.isActive('codeBlock'),
      selected: !instance.state.selection.empty,
      bold: instance.isActive('bold'),
      italic: instance.isActive('italic'),
      strike: instance.isActive('strike'),
      code: instance.isActive('code'),
      link: instance.isActive('link'),
      bullet: instance.isActive('bulletList'),
      ordered: instance.isActive('orderedList'),
    }),
  })

  // The link field takes focus from the page while it is open, so it has to
  // keep the bar up on its own.
  const visible = !state.hidden && (state.focused || linkOpen)

  // Going back to the page is the end of the link field, however it happened.
  useEffect(() => {
    const onFocus = () => setLinkOpen(false)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
    }
  }, [editor])

  // `position: fixed` pins to the layout viewport, which on iOS carries on
  // underneath the keyboard, so `bottom: 0` would put the bar behind the keys.
  // The visual viewport is the part actually on screen; the bar is moved to
  // its foot whenever it changes.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!visible || !bar) return
    const viewport = window.visualViewport

    const place = () => {
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      // With the keyboard up the home indicator is behind it, and padding for
      // it would only float the bar off the keys.
      bar.dataset.keyboard = String(viewport ? window.innerHeight - viewport.height > 120 : false)
      bar.style.transform = `translateY(${bottom - bar.offsetHeight}px)`
    }

    place()
    const observer = new ResizeObserver(place)
    observer.observe(bar)
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
    }
  }, [visible])

  // The browser keeps the caret above the keyboard, not above the bar, so the
  // line being typed on would otherwise slide under it at the foot of the
  // screen. Only a caret just behind the bar is nudged: one that is further
  // off was scrolled away from on purpose.
  useEffect(() => {
    if (!visible) return
    let frame = 0

    const keepCaretClear = () => {
      const bar = barRef.current
      if (!bar || !editor.isFocused) return
      let caret: { top: number; bottom: number }
      try {
        caret = editor.view.coordsAtPos(editor.state.selection.head)
      } catch {
        return
      }
      const overlap = caret.bottom - (bar.getBoundingClientRect().top - 12)
      if (overlap <= 0 || overlap > 240) return
      scrollParent(editor.view.dom)?.scrollBy({ top: overlap })
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(keepCaretClear)
    }

    editor.on('selectionUpdate', schedule)
    editor.on('update', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('selectionUpdate', schedule)
      editor.off('update', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [visible, editor])

  const closeLink = () => {
    setLinkOpen(false)
    setLinkValue('')
    editor.commands.focus()
  }

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

  if (!visible) return null

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label="Formatting"
      // Leaving the link field for anywhere but the bar or the page is leaving
      // the editor altogether, and the bar goes with it.
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && (barRef.current?.contains(next) || editor.view.dom.contains(next))) return
        setLinkOpen(false)
      }}
      className="fixed inset-x-0 top-0 z-40 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-soft)] data-[keyboard=true]:pb-0"
    >
      {linkOpen ? (
        <div className="flex items-start gap-1 px-2 py-1.5">
          <LinkPicker
            className="min-w-0 flex-1 pt-1.5"
            initialHref={linkValue}
            pages={pages ?? []}
            onApply={applyLink}
            onUnset={clearLink}
            onClose={closeLink}
          />
          <ToolButton icon="x" label="Close" onClick={closeLink} />
        </div>
      ) : (
        <div className="flex items-center gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none]">
          <ToolButton icon="bold" label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolButton icon="italic" label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <ToolButton icon="strike" label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <ToolButton icon="code" label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />
          <ToolButton
            icon="link"
            label="Link"
            active={state.link}
            // A link needs some text to sit on: either a selection, or the
            // link the caret is already inside.
            disabled={!state.selected && !state.link}
            onClick={() => {
              setLinkValue(editor.getAttributes('link').href ?? '')
              setLinkOpen(true)
            }}
          />
          <span className="mx-1 h-6 w-px shrink-0 bg-line" />
          <ToolButton icon="list" label="Bulleted list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolButton icon="listOrdered" label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        </div>
      )}
    </div>
  )
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element)
    if (overflowY === 'auto' || overflowY === 'scroll') return element
  }
  return null
}
