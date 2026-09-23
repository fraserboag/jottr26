'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { searchPages } from '@/lib/db/search'
import type { PageRow } from '@/lib/db/schema'

export function QuickSearch({
  pages,
  onOpen,
  onClose,
}: {
  pages: PageRow[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Nothing is listed until there is something to match against.
  const typing = query.trim() !== ''
  const hits = useMemo(() => (typing ? searchPages(pages, query) : []), [typing, pages, query])

  const [lastQuery, setLastQuery] = useState(query)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Adjusting state during render is React's recommended way to reset a value
  // when a prop changes; it re-renders before anything is painted.
  if (query !== lastQuery) {
    setLastQuery(query)
    setIndex(0)
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (id: string) => {
    onOpen(id)
    onClose()
  }

  // The middle row is the height of the search bar (a --body-size line plus
  // 2rem of padding) and four plain results (1lh + 1rem each), so that block
  // sits dead centre and the bar stays put however many results come back;
  // longer lists grow down into the last row.
  return (
    <div
      className="fixed inset-0 z-50 grid grid-rows-[1fr_calc(4lh_+_var(--body-size)_*_1.6_+_6.75rem_+_3px)_1fr] justify-items-center px-4 py-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="relative row-[2/4] flex max-h-full w-full self-start max-w-[540px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-[var(--shadow-pop)]"
      >
        <div className={`flex items-center gap-3.5 px-4 py-3 ${typing ? 'border-b border-line' : ''}`}>
          <Icon name="search" size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((i) => (hits.length ? (i + 1) % hits.length : 0))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const hit = hits[index]
                if (hit) choose(hit.page.id)
              } else if (event.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="Search your pages"
            className="w-full bg-transparent px-1.5 py-1 text-[length:var(--body-size)] outline-none placeholder:text-faint"
            aria-label="Search pages"
          />
        </div>

        {typing && (
          <ul ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {hits.length === 0 && (
              <li className="px-3 py-2.5 text-muted">No pages found</li>
            )}

            {hits.map((hit, i) => (
              <li key={hit.page.id}>
                <button
                  type="button"
                  data-active={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(hit.page.id)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    i === index ? 'bg-[var(--active)]' : ''
                  }`}
                >
                  <span className="flex h-[1lh] w-4 shrink-0 items-center justify-center">
                    <Icon name="file" size={14} className="text-faint" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">
                      {hit.page.title || 'Untitled'}
                    </span>
                    {hit.snippet && (
                      <span className="mt-0.5 block truncate text-[12px] text-faint pointer-coarse:text-[13px]">
                        {hit.snippet}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
