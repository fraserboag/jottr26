'use client'

import type { MouseEvent } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useChildPages } from '@/lib/db/hooks'
import { pageHref } from '@/lib/util/links'
import { useOpenPageId } from '@/lib/util/route'
import type { SubpagesOptions } from './extensions/subpages'

/** The subpage block as it is drawn: the open page's children, one link each.
 *
 *  The node view keeps ProseMirror out of clicks on the links, so following
 *  one is handled here, in place, the same way the editor follows a page link
 *  written in the text. The hrefs are real, so a modified or middle click
 *  still gets its new tab. */
export function SubpageList({ extension }: ReactNodeViewProps) {
  const { pageId } = extension.options as SubpagesOptions
  const pages = useChildPages(pageId)
  const [, openPage] = useOpenPageId()

  const follow = (event: MouseEvent, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openPage(id)
  }

  return (
    <NodeViewWrapper data-type="subpages" contentEditable={false}>
      {pages === undefined ? null : pages.length === 0 ? (
        <p className="subpages-empty">No subpages yet</p>
      ) : (
        <ul>
          {pages.map((page) => (
            <li key={page.id}>
              <a href={pageHref(page.id)} onClick={(event) => follow(event, page.id)}>
                {page.title || 'Untitled'}
              </a>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  )
}
