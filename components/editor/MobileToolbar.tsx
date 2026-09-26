'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { ToolButton } from '@/components/ui/ToolButton'
import { FormatButtons, formatFlags, useLinkEditing } from './formatActions'
import { LinkPicker } from './LinkPicker'
import { SlashList } from './SlashMenu'
import { useSlashMenu } from './useSlashMenu'
import { TableControls, useTableState } from './TableMenu'

/** The format menu for touch screens: the same actions as the bubble, on a bar
 *  that sits on top of the keyboard for as long as the page is being edited.
 *
 *  A bubble over the selection fights the phone for the same few pixels — the
 *  system's own copy and paste callout draws there too — and it only appears
 *  once text is selected, which on glass means dragging handles about first.
 *  Here the bar is always in reach, so formatting works the way it does in any
 *  notes app: select and tap, or tap and then type.
 *
 *  The / block menu opens on the bar too, as `blocks`. Pinned to the caret it
 *  had a few hundred pixels between the keyboard and the top of the screen to
 *  find room in, and usually ended up half behind the keys. */
export function MobileToolbar({ editor, pageId }: { editor: Editor; pageId: string }) {
  const { slash, pick, hover } = useSlashMenu()
  const blocks = slash && (
    <SlashList
      state={slash}
      onSelect={pick}
      onHover={hover}
      className="max-h-[var(--blocks-height,312px)] p-1.5"
    />
  )
  const link = useLinkEditing(editor)
  const barRef = useRef<HTMLDivElement>(null)
  const table = useTableState(editor)

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      ...formatFlags(instance),
      focused: instance.isFocused,
      // The same places the bubble stays away from: the title takes no marks,
      // and a code block takes none either.
      hidden: instance.isActive('title') || instance.isActive('codeBlock'),
      selected: !instance.state.selection.empty,
      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
    }),
  })

  // The link field takes focus from the page while it is open, so it has to
  // keep the bar up on its own. The block menu opens wherever '/' was typed,
  // code blocks included, so it brings the bar up even where the formatting
  // stays hidden.
  const formatting = !state.hidden && (state.focused || link.open)
  const visible = formatting || Boolean(blocks)

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
      // The block menu takes a little under half of what is on screen, and
      // scrolls past that. The rest is left for the line being typed on.
      const height = viewport ? viewport.height : window.innerHeight
      bar.style.setProperty('--blocks-height', `${Math.min(312, Math.round(height * 0.45))}px`)
      bar.style.transform = `translateY(${bottom - bar.offsetHeight}px)`
      // The page scrolls inside a box as tall as the layout viewport, so on
      // the last line it has already run out of scroll with the keyboard and
      // the bar still over it. The page pads its foot by this much for as long
      // as the bar is up, which leaves room to lift that line clear.
      document.documentElement.style.setProperty(
        '--toolbar-inset',
        `${Math.max(0, window.innerHeight - bottom) + bar.offsetHeight}px`,
      )
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
      document.documentElement.style.removeProperty('--toolbar-inset')
    }
  }, [visible])

  // The browser keeps the caret above the keyboard, not above the bar, so the
  // line being typed on would otherwise slide under it at the foot of the
  // screen. It is lifted a little further than just clear, so some blank page
  // shows below the line. Only a caret just behind the bar is nudged: one
  // that is further off was scrolled away from on purpose. The bar growing
  // counts too, which is the block menu opening over the line.
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
      const { top, bottom } = bar.getBoundingClientRect()
      const overlap = caret.bottom - (top - 40)
      if (overlap <= 0 || caret.bottom > bottom + 200) return
      scrollParent(editor.view.dom)?.scrollBy({ top: overlap })
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(keepCaretClear)
    }

    editor.on('selectionUpdate', schedule)
    editor.on('update', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    if (barRef.current) observer.observe(barRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      editor.off('selectionUpdate', schedule)
      editor.off('update', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [visible, editor])

  const closeLink = () => {
    link.close()
    editor.commands.focus()
  }

  // A phone keyboard keeps '/' a layer or two down, so the bar types it for
  // you. The slash menu only opens after a space or at the start of a line,
  // so a caret straight after a word gets a space first. Typing it over a
  // selection would delete the text, so the caret moves to its end instead.
  const openBlocks = () => {
    const { to } = editor.state.selection
    const $to = editor.state.doc.resolve(to)
    const before = $to.parent.textBetween(Math.max(0, $to.parentOffset - 1), $to.parentOffset, undefined, '\0')
    editor
      .chain()
      .focus()
      .setTextSelection(to)
      .insertContent(/^[ \n\0]?$/.test(before) ? '/' : ' /')
      .run()
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
        link.close()
      }}
      className="rise-in with-keyboard fixed inset-x-0 top-0 z-40 border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-soft)] data-[keyboard=true]:pb-0"
    >
      {/* The list slides up out of the formatting row the way the keyboard
          slides up out of the screen's edge, clipped so it never passes over
          the row on its way. */}
      {blocks && (
        <div className="overflow-hidden border-b border-line">
          <div className="rise-in with-keyboard">{blocks}</div>
        </div>
      )}
      {!formatting ? null : link.open ? (
        <div
          // Padded as the formatting row is, so the bar keeps its height and
          // nothing under it moves when the field opens.
          className="flex items-start gap-1 px-2 py-1"
        >
          <LinkPicker
            className="min-w-0 flex-1 pt-1.5"
            initialHref={link.value}
            onApply={link.apply}
            onUnset={link.clear}
            onClose={closeLink}
          />
          <ToolButton icon="x" label="Close" onClick={closeLink} />
        </div>
      ) : (
        <>
          {/* Inside a table its controls get a row of their own above the
              formatting, rather than a bubble over the grid that the keyboard,
              the system callout and the caret all compete with. */}
          {table && (
            <div
              role="group"
              aria-label="Table"
              className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1 [scrollbar-width:none]"
            >
              <TableControls editor={editor} state={table} />
            </div>
          )}
          <div className="flex items-center gap-1 px-2 py-1">
            <ToolButton icon="slash" label="Insert block" onClick={openBlocks} />
            <span className="mx-1 h-7 w-px shrink-0 bg-line" />
            {/* Only the formatting scrolls; the block and undo buttons stay
                pinned at either end so they are always in reach. */}
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              <FormatButtons
                editor={editor}
                pageId={pageId}
                flags={state}
                onLink={link.start}
                separatorClassName="mx-1 h-7 w-px shrink-0 bg-line"
                selected={state.selected}
              />
            </div>
            <span className="mx-1 h-7 w-px shrink-0 bg-line" />
            <ToolButton icon="undo" label="Undo" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()} />
            <ToolButton icon="redo" label="Redo" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()} />
          </div>
        </>
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
