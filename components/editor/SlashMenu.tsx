'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Icon } from '@/components/ui/Icon'
import type { SlashItem } from './extensions/slash'

export interface SlashMenuState {
  items: SlashItem[]
  index: number
  rect: DOMRect | null
}

const ROW = 42
const MAX_HEIGHT = 312
// Rows grow on touch screens along with their type.
const TOUCH_ROW = 60
const WIDTH = 268
const TOUCH_WIDTH = 300

export function SlashMenu({
  state,
  onSelect,
  onHover,
}: {
  state: SlashMenuState
  onSelect: (item: SlashItem) => void
  onHover: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Positioned against the caret, then nudged back inside the viewport. Flips
  // above the caret when there is no room below, which on a phone keyboard is
  // most of the time. A plain computation, so it costs no extra render.
  const position = useMemo(() => {
    const rect = state.rect
    if (!rect) return null

    const touch = window.matchMedia('(pointer: coarse)').matches
    const height = Math.min(MAX_HEIGHT, state.items.length * (touch ? TOUCH_ROW : ROW) + 10)
    const width = touch ? TOUCH_WIDTH : WIDTH
    const margin = 8
    // The visible part of the page, which on iOS stops at the top of the
    // keyboard while the window itself carries on underneath it.
    const viewport = window.visualViewport
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight

    const below = rect.bottom + 8
    const flip = below + height > bottom - margin && rect.top > height + margin

    return {
      top: flip ? rect.top - height - 8 : below,
      left: Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin),
      width,
    }
  }, [state.rect, state.items.length])

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [state.index])

  if (!position) return null

  return (
    <div
      role="listbox"
      aria-label="Insert block"
      className="fixed z-50 overflow-hidden rounded-xl border border-line bg-raised shadow-[var(--shadow-pop)]"
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      {state.items.length === 0 ? (
        <p className="px-3.5 py-3 text-faint">No blocks match that.</p>
      ) : (
        <div ref={listRef} className="scroll-thin max-h-[312px] overflow-y-auto p-1.5">
          {state.items.map((item, index) => {
            const active = index === state.index
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={active}
                data-active={active}
                onMouseEnter={() => onHover(index)}
                // Mouse down would blur the editor and close the menu first.
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(item)
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-[var(--active)]' : ''
                }`}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-sunken text-muted">
                  <Icon name={item.icon} size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-faint pointer-coarse:text-[13px]">{item.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
