'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Popover } from '@/components/ui/Popover'

type Space = { id: string; name: string }

export function SpaceSwitcher({ spaces, selectedId, onSelect }: {
  spaces: Space[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selectedName = spaces.find((space) => space.id === selectedId)?.name ?? ''

  return (
    <Popover
      label="Choose space"
      trigger={({ open, toggle, ref }) => (
        <button
          type="button"
          ref={(node) => { ref(node); triggerRef.current = node }}
          aria-label={`Choose space: ${selectedName}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) toggle()
            }
          }}
          className="relative mt-3 mb-1.5 inline-flex max-w-full cursor-default items-center rounded bg-transparent py-0 pl-2 pr-6 text-[11.5px] font-semibold uppercase tracking-wide text-faint hover:text-muted focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:text-[12.5px]"
        >
          <span className="truncate">{selectedName}</span>
          <Icon name="chevronDown" size={13} className="pointer-events-none absolute right-1" />
        </button>
      )}
    >
      {(close) => (
        <SpaceOptions spaces={spaces} selectedId={selectedId} onSelect={onSelect} close={close}
          restoreFocus={() => triggerRef.current?.focus({ preventScroll: true })} />
      )}
    </Popover>
  )
}

function SpaceOptions({ spaces, selectedId, onSelect, close, restoreFocus }: {
  spaces: Space[]
  selectedId: string
  onSelect: (id: string) => void
  close: () => void
  restoreFocus: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef({ text: '', time: 0 })

  useEffect(() => {
    // Wait until the popover has positioned and revealed its panel.
    const frame = requestAnimationFrame(() => {
      const selected = listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      selected?.focus({ preventScroll: true })
      selected?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next = index
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'Tab') {
      // Let the browser continue from the trigger in the sidebar's tab order.
      close()
      restoreFocus()
      return
    }
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      restoreFocus()
      return
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const text = (now - searchRef.current.time < 500 ? searchRef.current.text : '') + event.key.toLocaleLowerCase()
      searchRef.current = { text, time: now }
      const prefix = Array.from(text).every((character) => character === text[0]) ? text[0] : text
      for (let offset = 1; offset <= spaces.length; offset++) {
        const candidate = (index + offset) % spaces.length
        if (spaces[candidate].name.toLocaleLowerCase().startsWith(prefix)) { next = candidate; break }
      }
    } else return
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <div ref={listRef} onKeyDown={onKeyDown}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}
      className="max-h-[min(320px,calc(100dvh-32px))] overflow-y-auto overscroll-contain"
    >
      {spaces.map((space) => (
        <button key={space.id} type="button" role="menuitemradio" aria-checked={space.id === selectedId} tabIndex={-1}
          onClick={() => { close(); restoreFocus(); onSelect(space.id) }}
          className="flex w-full cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-left text-ink transition-colors hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">{space.name}</span>
          <span className="grid size-4 shrink-0 place-items-center text-muted">
            {space.id === selectedId && <Icon name="check" size={14} />}
          </span>
        </button>
      ))}
    </div>
  )
}
