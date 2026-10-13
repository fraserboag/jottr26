'use client'

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent, type PointerEvent } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Icon } from '@/components/ui/Icon'
import { MenuItem, Popover } from '@/components/ui/Popover'
import { PageActions } from '@/components/workspace/PageActions'
import { useChildPages, useGrandchildPages } from '@/lib/db/hooks'
import { createPage, dropRelative } from '@/lib/db/pages'
import { raiseKeyboard } from '@/lib/util/keyboard'
import { isPlainLeftClick, pageHref } from '@/lib/util/links'
import { useOpenPageId } from '@/lib/util/route'
import type { PageRow } from '@/lib/db/schema'
import type { SubpagesOptions } from './extensions/subpages'

/** The subpage block as it is drawn: the open page's children, one link each,
 *  under the block's heading, which is the one part of it written in.
 *
 *  The node view keeps ProseMirror out of clicks on the entries, so following
 *  one is handled here, in place, the same way the editor follows a page link
 *  written in the text. A click anywhere on an entry but its actions follows it.
 *  The title's href is real, so a modified or middle click there
 *  still gets its new tab.
 *
 *  The entries drag to reorder, with the sidebar's own move: both lists sort by
 *  the same key, so a page dragged here moves there too, and on every other
 *  device. As in the sidebar, dropped on an entry's top or bottom edge it goes
 *  above or below it, and on its middle it goes inside, at the end of that
 *  page's subpages, which takes it out of this list.
 *
 *  Each entry has the sidebar's favourite and trash buttons, and the plus in the corner is
 *  the sidebar's own plus for this page: a new, empty subpage at the end of
 *  the list, opened straight away, with this page's branch in the sidebar
 *  opened to show it.
 *
 *  The three dots beside it hold the block's own settings, so far only its
 *  depth. At a depth of two, each child becomes a heading with its own
 *  children listed under it; a child with none still gets its heading, so it
 *  stays in reach, with nothing under it. A heading has the sidebar's plus as
 *  well as its actions, for a new subpage under it; the entries below don't, as
 *  what they'd add would sit a level deeper than the list shows. Dragging there
 *  also moves a page between headings, as the sidebar does. Headings drag
 *  too, carrying their subpages with them. On either a heading or an entry,
 *  the edges reorder and the middle nests; the middle of a heading is also
 *  the way into a page with no subpages. */

type Drop = { id: string; zone: 'before' | 'after' | 'inside' }

const DEPTHS = [1, 2] as const

/** One of the list's own controls — an entry, a group's heading, a button or a
 *  link — rather than the heading above it, which is written in. */
export function isListControl(target: Element) {
  return !target.closest('.subpages-title') && !!target.closest('li, .subpages-group-head, button, a')
}

export function SubpageList({ editor, extension, node, getPos, updateAttributes }: ReactNodeViewProps) {
  const { pageId } = extension.options as SubpagesOptions
  const depth = node.attrs.depth === 2 ? 2 : 1
  const pages = useChildPages(pageId)
  const groups = useGrandchildPages(pageId, depth === 2)
  const [, openPage] = useOpenPageId()
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pointerType = useRef('')

  const follow = (event: MouseEvent, id: string) => {
    if (!isPlainLeftClick(event)) return
    // Clicks on the note's actions belong to their buttons.
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest('.subpages-row-actions')) return
    event.preventDefault()
    openPage(id)
  }

  // The block sits inside the editor's editable element, so a press on any of
  // its controls would focus the editor, and on a phone raise the keyboard, for
  // a tap that types nothing. Refused here, as the toolbar's buttons do; the
  // tap still clicks. Not for a mouse press on an entry, which is how a drag
  // starts. A touch press is safe to refuse there: its mousedown only comes
  // once the finger has lifted, after any drag.
  //
  // Anywhere else but the heading, a press selects the whole block, so it can
  // be deleted. ProseMirror only does that itself for a block with no text in
  // it, which this one no longer is.
  const pressDown = (event: MouseEvent) => {
    const target = event.target
    // The heading is written in, and the menus' presses, bubbled up here by
    // React from the portals they're drawn in, are the menus' own.
    if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest('.subpages-title')) return
    if (!isListControl(target)) {
      event.preventDefault()
      const pos = getPos()
      if (typeof pos === 'number') editor.chain().focus().setNodeSelection(pos).run()
      return
    }
    if (pointerType.current === 'mouse' && target.closest('li, .subpages-group-head') && !target.closest('.subpages-row-actions')) return
    event.preventDefault()
  }

  const add = (parentId: string) => {
    // Before anything is awaited, or a phone won't raise its keyboard for the
    // new page's title.
    raiseKeyboard()
    // The sidebar is left as it was: which of its branches are open is the
    // user's to decide there, not something the editor changes.
    void createPage({ parentId }).then(openPage)
  }

  const end = () => {
    setDragId(null)
    setDrop(null)
  }

  const start = (event: ReactDragEvent, id: string) => {
    setDragId(id)
    event.dataTransfer.effectAllowed = 'move'
    // A type of its own rather than text/plain, which the editor would paste
    // in as the page's id if it were dropped anywhere else on the page.
    event.dataTransfer.setData('application/x-jottr-subpage', id)
  }

  // A page trashed or moved away on another device mid-drag takes its entry
  // with it, and a browser sends no dragend for an element that has gone. The
  // drag is over then, or the listeners below would refuse every drag in the
  // editor until the page was reloaded.
  const listed = depth === 2 ? groups?.flatMap((group) => [group.page, ...group.children.map((child) => child.page)]) : pages
  const dragging = dragId && listed?.some((page) => page.id === dragId) ? dragId : null

  // While an entry is being dragged, this block has every drag event in the
  // editor to itself. Left to reach the editor, they draw its drop cursor
  // round the block and would let the entry land in the text; the node view's
  // own filter can't stop that, because the drop cursor listens on the
  // editor's element directly. So they are caught on the way down, before
  // anything else sees them, and the drop is decided here: over the list it
  // moves the page, anywhere else it is refused.
  useEffect(() => {
    if (!dragging) return
    const dom = editor.view.dom
    const list = listRef.current
    let target: Drop | null = null
    const place = (next: Drop | null) => {
      if (next?.id === target?.id && next?.zone === target?.zone) return
      target = next
      setDrop(next)
    }
    const inList = (node: EventTarget | null) => node instanceof Node && !!list?.contains(node)

    const over = (event: DragEvent) => {
      event.stopPropagation()
      if (!inList(event.target)) return place(null)
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      const element = event.target instanceof Element ? event.target : null
      const item = element?.closest<HTMLElement>('li, .subpages-group-head')
      // In the gap between two entries the line stays where it was.
      if (!item) return
      const id = item.dataset.id
      if (!id || id === dragging) return place(null)
      // The sidebar's split: the edges reorder, the middle nests.
      const rect = item.getBoundingClientRect()
      const offset = (event.clientY - rect.top) / rect.height
      place({ id, zone: offset < 0.28 ? 'before' : offset > 0.72 ? 'after' : 'inside' })
    }
    const leave = (event: DragEvent) => {
      event.stopPropagation()
      if (!inList(event.relatedTarget)) place(null)
    }
    const land = (event: DragEvent) => {
      event.stopPropagation()
      event.preventDefault()
      if (target) void dropRelative(dragging, target.id, target.zone)
      end()
    }

    dom.addEventListener('dragenter', over, true)
    dom.addEventListener('dragover', over, true)
    dom.addEventListener('dragleave', leave, true)
    dom.addEventListener('drop', land, true)
    return () => {
      dom.removeEventListener('dragenter', over, true)
      dom.removeEventListener('dragover', over, true)
      dom.removeEventListener('dragleave', leave, true)
      dom.removeEventListener('drop', land, true)
    }
  }, [dragging, editor])

  const entry = (page: PageRow) => (
    <li
      key={page.id}
      data-id={page.id}
      draggable
      data-dragging={dragging === page.id || undefined}
      data-drop={dragging && drop?.id === page.id ? drop.zone : undefined}
      onDragStart={(event) => start(event, page.id)}
      onDragEnd={end}
      onClick={(event) => follow(event, page.id)}
    >
      <Icon name="file" size={15} className="text-muted" />
      {/* Not draggable itself, so a drag picks up the whole entry
          rather than the link's address. */}
      <a href={pageHref(page.id)} draggable={false}>
        {page.title || 'Untitled'}
      </a>
      <span className="subpages-row-actions">
        <PageActions page={page} />
      </span>
    </li>
  )

  const items = depth === 2 ? groups : pages
  const list =
    items === undefined ? null : items.length === 0 ? (
      <p className="subpages-empty">No subpages yet</p>
    ) : (
      <div ref={listRef}>
        {depth === 2 && groups ? (
          groups.map(({ page, children }) => (
            <div key={page.id} className="subpages-group">
              <div
                className="subpages-group-head"
                data-id={page.id}
                draggable
                data-dragging={dragging === page.id || undefined}
                data-drop={dragging && drop?.id === page.id ? drop.zone : undefined}
                onDragStart={(event) => start(event, page.id)}
                onDragEnd={end}
                onClick={(event) => follow(event, page.id)}
              >
                <a href={pageHref(page.id)} draggable={false}>
                  {page.title || 'Untitled'}
                </a>
                <span className="subpages-row-actions">
                  <button
                    type="button"
                    aria-label="Add a subpage"
                    onClick={(event) => {
                      event.stopPropagation()
                      add(page.id)
                    }}
                    className="grid size-6 touch-manipulation place-items-center rounded-md text-faint transition-colors hover:bg-[var(--active)] hover:text-muted active:bg-[var(--active)] pointer-coarse:h-10 pointer-coarse:w-8 pointer-coarse:text-muted pointer-coarse:[&_svg]:size-5"
                  >
                    <Icon name="plus" size={16} strokeWidth={2} />
                  </button>
                  <PageActions page={page} />
                </span>
              </div>
              {children.length > 0 && <ul>{children.map((child) => entry(child.page))}</ul>}
            </div>
          ))
        ) : (
          <ul>{pages?.map(entry)}</ul>
        )}
      </div>
    )

  return (
    <NodeViewWrapper
      data-type="subpages"
      onPointerDown={(event: PointerEvent) => {
        pointerType.current = event.pointerType
      }}
      onMouseDown={pressDown}
    >
      <div className="subpages-head">
        <NodeViewContent className="subpages-heading" />
        <div className="subpages-actions" contentEditable={false}>
          <Popover
            width={160}
            align="end"
            label="Subpage list options"
            trigger={({ open, toggle, ref }) => (
              <button
                type="button"
                ref={ref}
                className="subpages-button"
                data-open={open || undefined}
                aria-label="Subpage list options"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
              >
                <Icon name="more" size={16} strokeWidth={3.6} />
              </button>
            )}
          >
            {(close) => (
              <>
                {DEPTHS.map((value) => (
                  <MenuItem
                    key={value}
                    checked={value === depth}
                    onClick={() => {
                      updateAttributes({ depth: value })
                      close()
                    }}
                  >
                    {value === 1 ? '1 level' : '2 levels'}
                  </MenuItem>
                ))}
              </>
            )}
          </Popover>
          <button type="button" className="subpages-button" aria-label="Add a subpage" onClick={() => add(pageId)}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div className="subpages-box" contentEditable={false}>
        {list}
      </div>
    </NodeViewWrapper>
  )
}
