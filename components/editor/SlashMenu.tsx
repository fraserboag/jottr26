'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Icon } from '@/components/ui/Icon'
import type { SlashItem } from './extensions/slash'

export interface SlashMenuState {
  items: SlashItem[]
  index: number
  rect: DOMRect | null
}

interface SlashListProps {
  state: SlashMenuState
  onSelect: (item: SlashItem) => void
  onHover: (index: number) => void
}

const ROW = 42
const MAX_HEIGHT = 312
const WIDTH = 268

/** The desktop's menu: a popover against the caret. Touch screens show the
 *  same list on the keyboard bar instead, see MobileToolbar. */
export function SlashMenu(props: SlashListProps) {
  const { state } = props

  // Positioned against the caret, then nudged back inside the viewport. Flips
  // above the caret when there is no room below. A plain computation, so it
  // costs no extra render.
  const position = useMemo(() => {
    const rect = state.rect
    if (!rect) return null

    const height = Math.min(MAX_HEIGHT, state.items.length * ROW + 10)
    const margin = 8
    const below = rect.bottom + 8
    const flip = below + height > window.innerHeight - margin && rect.top > height + margin

    return {
      top: flip ? rect.top - height - 8 : below,
      left: Math.min(Math.max(margin, rect.left), window.innerWidth - WIDTH - margin),
    }
  }, [state.rect, state.items.length])

  if (!position) return null

  return (
    <div
      className="fixed z-50 overflow-hidden rounded-xl border border-line bg-raised shadow-[var(--shadow-pop)] pop-in"
      style={{ top: position.top, left: position.left, width: WIDTH }}
    >
      <SlashList {...props} className="max-h-[312px] p-1.5" />
    </div>
  )
}

export function SlashList({
  state,
  onSelect,
  onHover,
  className = '',
}: SlashListProps & { className?: string }) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scrolls the list alone. `scrollIntoView` would scroll every ancestor too,
  // and on a phone that includes the visual viewport, which drags the page
  // about under the keyboard.
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[data-active="true"]')
    if (!list || !active) return
    if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop
    else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight
    }
  }, [state.index])

  if (state.items.length === 0) {
    return <p className="px-3.5 py-3 text-faint">No blocks match that.</p>
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Insert block"
      // A drag that reaches the end of the list stops there rather than
      // carrying on into the page behind it.
      className={`scroll-thin relative overflow-y-auto overscroll-contain ${className}`}
    >
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
  )
}
