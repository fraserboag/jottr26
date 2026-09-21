'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { createPage } from '@/lib/db/pages'
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

  const hits = useMemo(() => searchPages(pages, query), [pages, query])

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="absolute inset-0 bg-[var(--overlay)]" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="relative flex max-h-[68vh] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
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
                else void createPage({ title: query.trim() }).then(choose)
              } else if (event.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="Search your pages"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="Search pages"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-faint">esc</kbd>
        </div>

        <ul ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {hits.length === 0 && (
            <li>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void createPage({ title: query.trim() }).then(choose)}
                className="flex w-full items-center gap-2.5 rounded-lg bg-[var(--active)] px-3 py-2.5 text-left"
              >
                <Icon name="plus" size={15} className="text-accent" />
                <span className="min-w-0 text-[13.5px] text-ink">
                  Create <span className="font-medium">{query.trim() || 'a new page'}</span>
                </span>
              </button>
            </li>
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
                <span className="mt-px w-4 shrink-0 text-center text-[13px] leading-5">
                  <Icon name="file" size={14} className="text-faint" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">
                    {hit.page.title || 'Untitled'}
                  </span>
                  {hit.snippet && (
                    <span className="mt-0.5 block truncate text-[12px] text-faint">
                      {hit.snippet}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
