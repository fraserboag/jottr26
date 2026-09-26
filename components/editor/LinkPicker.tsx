'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { searchPages } from '@/lib/db/search'
import { usePages } from '@/components/workspace/PagesContext'
import { looksLikeUrl, normalizeHref, pageHref, resolveLink } from '@/lib/util/links'
import { scrollIntoList } from '@/lib/util/scroll'

/** One suggestion under the link field. The URL row is always present once
 *  something has been typed, so a page you meant to find is never the only way
 *  out of the box, and neither is a URL. */
type Row =
  | { kind: 'page'; pageId: string; title: string; snippet: string | null }
  | { kind: 'url'; href: string }

const LIMIT = 6

export function LinkPicker({
  initialHref,
  onApply,
  onUnset,
  onClose,
  className = 'w-[19rem]',
}: {
  initialHref: string
  onApply: (href: string) => void
  onUnset: () => void
  onClose: () => void
  className?: string
}) {
  // The picker searches the same local page list the sidebar reads, so
  // linking to a note works offline like everything else here.
  const pages = usePages()
  const [query, setQuery] = useState(initialHref)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Where the pointer last was. Arrow keys scroll rows under a still cursor,
  // which fires enter and move events without the mouse going anywhere, so
  // only a real change of position picks a row — as in the / menu.
  const pointer = useRef({ x: -1, y: -1 })

  // The field opens where it is already in view — in the bubble at the
  // selection, or in the bar over the keyboard — and a plain focus would have
  // the phone scroll the page to show it anyway.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[data-active="true"]')
    if (list && active) scrollIntoList(list, active)
  }, [index])

  const rows = useMemo<Row[]>(() => {
    const value = query.trim()
    if (!value) return []
    const found: Row[] = searchPages(pages, value)
      .slice(0, LIMIT)
      .map((hit) => ({
        kind: 'page',
        pageId: hit.page.id,
        title: hit.page.title || 'Untitled',
        snippet: hit.snippet,
      }))
    const url: Row = { kind: 'url', href: normalizeHref(value) }
    return looksLikeUrl(value) ? [url, ...found] : [...found, url]
  }, [pages, query])

  const choose = (row: Row) => {
    if (row.kind === 'page') return onApply(pageHref(row.pageId))
    // A pasted address of one of your own pages is stored relative, so the
    // link works wherever the workspace is opened rather than only where it
    // was copied from.
    const target = resolveLink(row.href, window.location.href)
    onApply(target?.kind === 'page' ? pageHref(target.pageId) : row.href)
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center gap-2.5 px-1.5">
        {/* Drawn as the toolbar it replaces draws its icons, so opening the
            box does not shrink the link glyph under the pointer. */}
        <Icon
          name="link"
          size={19}
          strokeWidth={1.8}
          className="shrink-0 text-faint pointer-coarse:size-5"
        />

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            // Enter that commits a Japanese, Chinese or Korean word is not
            // Enter that picks a row. Safari reports it only as key code 229.
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((i) => (rows.length ? (i + 1) % rows.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const row = rows[index]
              // An emptied field means the link is being taken off, which is
              // what this box has always done with a blank Enter.
              if (row) choose(row)
              else onUnset()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder="Paste a link, or search your pages"
          // Under 16px, iOS zooms the page in on focus and leaves it there.
          aria-label="Link address or page search"
          className="w-full bg-transparent py-1 outline-none placeholder:text-faint"
        />
      </div>

      {rows.length > 0 && (
        <ul
          ref={listRef}
          className="scroll-thin mt-1 max-h-56 overflow-y-auto border-t border-line pt-1"
        >
          {rows.map((row, i) => (
            <li key={row.kind === 'page' ? row.pageId : 'url'}>
              <button
                type="button"
                data-active={i === index}
                onMouseMove={(event) => {
                  const { clientX: x, clientY: y } = event
                  if (x === pointer.current.x && y === pointer.current.y) return
                  pointer.current = { x, y }
                  if (i !== index) setIndex(i)
                }}
                // Without this the editor loses its selection on mousedown, the
                // bubble menu hides, and the click never lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(row)}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left pointer-coarse:py-2.5 transition-colors ${
                  i === index ? 'bg-[var(--active)]' : ''
                }`}
              >
                <span className="mt-px shrink-0">
                  <Icon
                    name={row.kind === 'page' ? 'file' : 'link'}
                    size={13}
                    className="text-faint"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  {row.kind === 'page' ? (
                    <>
                      <span className="block truncate text-ink">{row.title}</span>
                      {row.snippet && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-faint pointer-coarse:text-[13px]">
                          {row.snippet}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="block truncate text-muted">
                      Link to <span className="text-ink">{row.href}</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
