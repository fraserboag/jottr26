'use client'

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Icon } from '@/components/ui/Icon'
import { MenuItem, Popover } from '@/components/ui/Popover'
import { PageMenu } from '@/components/workspace/PageMenu'
import { useChildPages, useGrandchildPages } from '@/lib/db/hooks'
import { createPage, dropRelative } from '@/lib/db/pages'
import { expandPage } from '@/lib/util/expanded'
import { raiseKeyboard } from '@/lib/util/keyboard'
import { pageHref } from '@/lib/util/links'
import { useOpenPageId } from '@/lib/util/route'
import type { PageRow } from '@/lib/db/schema'
import type { SubpagesOptions } from './extensions/subpages'

/** The subpage block as it is drawn: the open page's children, one link each.
 *
 *  The node view keeps ProseMirror out of clicks on the entries, so following
 *  one is handled here, in place, the same way the editor follows a page link
 *  written in the text. A click anywhere on an entry but its menu follows it.
 *  The title's href is real, so a modified or middle click there
 *  still gets its new tab.
 *
 *  The entries drag to reorder, with the sidebar's own move: both lists sort by
 *  the same key, so a page dragged here moves there too, and on every other
 *  device. Only above or below another entry — dropping one page into another
 *  would take it out of this list, which is the sidebar's job.
 *
 *  Each entry has the sidebar's three-dot menu, and the plus in the corner is
 *  the sidebar's own plus for this page: a new, empty subpage at the end of
 *  the list, opened straight away, with this page's branch in the sidebar
 *  opened to show it.
 *
 *  The three dots beside it hold the block's own settings, so far only its
 *  depth. At a depth of two, each child becomes a heading with its own
 *  children listed under it; a child with none still gets its heading, so it
 *  stays in reach, with nothing under it. A heading has the sidebar's plus as
 *  well as its menu, for a new subpage under it; the entries below don't, as
 *  what they'd add would sit a level deeper than the list shows. Dragging there
 *  also moves a page between headings, as the sidebar does: dropped above or
 *  below another heading's entry, or onto the heading itself, which puts it at
 *  the end of that heading's list, and is the only way into one with none. */

type Drop = { id: string; zone: 'before' | 'after' | 'inside' }

const DEPTHS = [1, 2] as const

export function SubpageList({ editor, extension, node, updateAttributes }: ReactNodeViewProps) {
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
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    // Clicks in the menu, including on its items, which React bubbles up here
    // from the portal they're drawn in, are the menu's own.
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest('.subpages-menu')) return
    event.preventDefault()
    openPage(id)
  }

  // The block sits inside the editor's editable element, so a press on any of
  // its controls would focus the editor, and on a phone raise the keyboard, for
  // a tap that types nothing. Refused here, as the toolbar's buttons do; the
  // tap still clicks. Not for a mouse press on an entry, which is how a drag
  // starts. A touch press is safe to refuse there: its mousedown only comes
  // once the finger has lifted, after any drag.
  const keepFocus = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('li, .subpages-group-head, button, a')) return
    if (pointerType.current === 'mouse' && target.closest('li') && !target.closest('.subpages-menu')) return
    event.preventDefault()
  }

  const add = (parentId: string) => {
    // Before anything is awaited, or a phone won't raise its keyboard for the
    // new page's title.
    raiseKeyboard()
    void createPage({ parentId }).then((id) => {
      expandPage(pageId)
      expandPage(parentId)
      openPage(id)
    })
  }

  const end = () => {
    setDragId(null)
    setDrop(null)
  }

  // A page trashed or moved away on another device mid-drag takes its entry
  // with it, and a browser sends no dragend for an element that has gone. The
  // drag is over then, or the listeners below would refuse every drag in the
  // editor until the page was reloaded.
  const listed = depth === 2 ? groups?.flatMap((group) => group.children.map((child) => child.page)) : pages
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
      const head = element?.closest<HTMLElement>('.subpages-group-head')
      if (head?.dataset.id) return place({ id: head.dataset.id, zone: 'inside' })
      const item = element?.closest('li')
      // In the gap between two entries the line stays where it was.
      if (!item) return
      const id = item.dataset.id
      if (!id || id === dragging) return place(null)
      const rect = item.getBoundingClientRect()
      place({ id, zone: event.clientY - rect.top < rect.height / 2 ? 'before' : 'after' })
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
      onDragStart={(event) => {
        setDragId(page.id)
        event.dataTransfer.effectAllowed = 'move'
        // A type of its own rather than text/plain, which the editor
        // would paste in as the page's id if the entry were dropped
        // anywhere else on the page.
        event.dataTransfer.setData('application/x-jottr-subpage', page.id)
      }}
      onDragEnd={end}
      onClick={(event) => follow(event, page.id)}
    >
      <Icon name="file" size={15} className="text-faint" />
      {/* Not draggable itself, so a drag picks up the whole entry
          rather than the link's address. */}
      <a href={pageHref(page.id)} draggable={false}>
        {page.title || 'Untitled'}
      </a>
      <span className="subpages-menu">
        <PageMenu page={page} />
      </span>
    </li>
  )

  const list =
    depth === 2 ? (
      groups === undefined ? null : groups.length === 0 ? (
        <p className="subpages-empty">No subpages yet</p>
      ) : (
        <div ref={listRef}>
          {groups.map(({ page, children }) => (
            <div key={page.id} className="subpages-group">
              <div
                className="subpages-group-head"
                data-id={page.id}
                data-drop={dragging && drop?.id === page.id ? drop.zone : undefined}
                onClick={(event) => follow(event, page.id)}
              >
                <a href={pageHref(page.id)} draggable={false}>
                  {page.title || 'Untitled'}
                </a>
                <span className="subpages-menu">
                  <PageMenu page={page} />
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
                </span>
              </div>
              {children.length > 0 && <ul>{children.map((child) => entry(child.page))}</ul>}
            </div>
          ))}
        </div>
      )
    ) : pages === undefined ? null : pages.length === 0 ? (
      <p className="subpages-empty">No subpages yet</p>
    ) : (
      <div ref={listRef}>
        <ul>{pages.map(entry)}</ul>
      </div>
    )

  return (
    <NodeViewWrapper
      data-type="subpages"
      contentEditable={false}
      onPointerDown={(event: PointerEvent) => {
        pointerType.current = event.pointerType
      }}
      onMouseDown={keepFocus}
    >
      <div className="subpages-head">
        <p className="subpages-title">Subpages</p>
        <div className="subpages-actions">
          <Popover
            width="auto"
            align="end"
            trigger={({ open, toggle, ref }) => (
              <button
                type="button"
                ref={ref}
                className="subpages-button"
                data-open={open || undefined}
                aria-label="Subpage list options"
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
                    icon={<Icon name="check" size={14} className={value === depth ? '' : 'invisible'} />}
                    onClick={() => {
                      updateAttributes({ depth: value })
                      close()
                    }}
                  >
                    {value === 1 ? '1 level deep' : '2 levels deep'}
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
      <div className="subpages-box">{list}</div>
    </NodeViewWrapper>
  )
}
