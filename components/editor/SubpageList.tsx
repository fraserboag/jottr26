'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Icon } from '@/components/ui/Icon'
import { useChildPages } from '@/lib/db/hooks'
import { dropRelative } from '@/lib/db/pages'
import { pageHref } from '@/lib/util/links'
import { useOpenPageId } from '@/lib/util/route'
import type { SubpagesOptions } from './extensions/subpages'

/** The subpage block as it is drawn: the open page's children, one link each.
 *
 *  The node view keeps ProseMirror out of clicks on the links, so following
 *  one is handled here, in place, the same way the editor follows a page link
 *  written in the text. The hrefs are real, so a modified or middle click
 *  still gets its new tab.
 *
 *  The entries drag to reorder, with the sidebar's own move: both lists sort by
 *  the same key, so a page dragged here moves there too, and on every other
 *  device. Only above or below another entry — dropping one page into another
 *  would take it out of this list, which is the sidebar's job. */

type Drop = { id: string; zone: 'before' | 'after' }

export function SubpageList({ editor, extension }: ReactNodeViewProps) {
  const { pageId } = extension.options as SubpagesOptions
  const pages = useChildPages(pageId)
  const [, openPage] = useOpenPageId()
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const follow = (event: MouseEvent, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openPage(id)
  }

  const end = () => {
    setDragId(null)
    setDrop(null)
  }

  // While an entry is being dragged, this block has every drag event in the
  // editor to itself. Left to reach the editor, they draw its drop cursor
  // round the block and would let the entry land in the text; the node view's
  // own filter can't stop that, because the drop cursor listens on the
  // editor's element directly. So they are caught on the way down, before
  // anything else sees them, and the drop is decided here: over the list it
  // moves the page, anywhere else it is refused.
  useEffect(() => {
    if (!dragId) return
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
      const item = event.target instanceof Element ? event.target.closest('li') : null
      // In the gap between two entries the line stays where it was.
      if (!item) return
      const id = item.dataset.id
      if (!id || id === dragId) return place(null)
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
      if (target) void dropRelative(dragId, target.id, target.zone)
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
  }, [dragId, editor])

  return (
    <NodeViewWrapper data-type="subpages" contentEditable={false}>
      <p className="subpages-title">Subpages</p>
      <div className="subpages-box">
        {pages === undefined ? null : pages.length === 0 ? (
          <p className="subpages-empty">No subpages yet</p>
        ) : (
          <ul ref={listRef}>
            {pages.map((page) => (
              <li
                key={page.id}
                data-id={page.id}
                draggable
                data-dragging={dragId === page.id || undefined}
                data-drop={drop?.id === page.id ? drop.zone : undefined}
                onDragStart={(event) => {
                  setDragId(page.id)
                  event.dataTransfer.effectAllowed = 'move'
                  // A type of its own rather than text/plain, which the editor
                  // would paste in as the page's id if the entry were dropped
                  // anywhere else on the page.
                  event.dataTransfer.setData('application/x-jottr-subpage', page.id)
                }}
                onDragEnd={end}
              >
                <Icon name="file" size={15} className="text-faint" />
                {/* Not draggable itself, so a drag picks up the whole entry
                    rather than the link's address. */}
                <a
                  href={pageHref(page.id)}
                  draggable={false}
                  onClick={(event) => follow(event, page.id)}
                >
                  {page.title || 'Untitled'}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NodeViewWrapper>
  )
}
