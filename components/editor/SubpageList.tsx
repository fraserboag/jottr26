'use client'

import { useState, type DragEvent, type MouseEvent } from 'react'
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
export function SubpageList({ extension }: ReactNodeViewProps) {
  const { pageId } = extension.options as SubpagesOptions
  const pages = useChildPages(pageId)
  const [, openPage] = useOpenPageId()
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; zone: 'before' | 'after' } | null>(null)

  const follow = (event: MouseEvent, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openPage(id)
  }

  const over = (event: DragEvent, id: string) => {
    if (!dragId || dragId === id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const zone = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setDrop({ id, zone })
  }

  const end = () => {
    setDragId(null)
    setDrop(null)
  }

  return (
    <NodeViewWrapper data-type="subpages" contentEditable={false}>
      <p className="subpages-title">Subpages</p>
      {pages === undefined ? null : pages.length === 0 ? (
        <p className="subpages-empty">No subpages yet</p>
      ) : (
        <ul>
          {pages.map((page) => (
            <li
              key={page.id}
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
              onDragOver={(event) => over(event, page.id)}
              onDragLeave={() => setDrop(null)}
              onDrop={(event) => {
                event.preventDefault()
                if (dragId && drop) void dropRelative(dragId, drop.id, drop.zone)
                end()
              }}
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
    </NodeViewWrapper>
  )
}
