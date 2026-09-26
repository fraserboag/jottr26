'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SlashHandlers, SlashItem } from './extensions/slash'
import { claimSlashBridge, releaseSlashBridge } from './slashBridge'
import type { SlashMenuState } from './SlashMenu'

/** The / menu's state, claimed from the editor's plugin through the bridge.
 *  Called by whatever draws the menu — the desktop's popover, or the keyboard
 *  bar on a touch screen — so that typing a filter re-renders just that, not
 *  the editor around it. */
export function useSlashMenu() {
  const [slash, setSlash] = useState<SlashMenuState | null>(null)
  const slashRef = useRef<{ items: SlashItem[]; index: number; command: (item: SlashItem) => void }>({
    items: [],
    index: 0,
    command: () => {},
  })
  const move = useCallback((delta: number) => {
    const { items, index } = slashRef.current
    if (items.length === 0) return
    const next = (index + delta + items.length) % items.length
    slashRef.current.index = next
    setSlash((current) => (current ? { ...current, index: next } : current))
  }, [])
  const pick = useCallback((item: SlashItem) => slashRef.current.command(item), [])
  const hover = useCallback((index: number) => {
    slashRef.current.index = index
    setSlash((current) => (current ? { ...current, index } : current))
  }, [])

  useEffect(() => {
    const handlers: SlashHandlers = {
      onStart: (props) => {
        slashRef.current = { items: props.items, index: 0, command: props.command }
        setSlash({ items: props.items, index: 0, measure: props.clientRect ?? null })
      },
      onUpdate: (props) => {
        const index = Math.min(slashRef.current.index, Math.max(0, props.items.length - 1))
        slashRef.current = { items: props.items, index, command: props.command }
        setSlash({ items: props.items, index, measure: props.clientRect ?? null })
      },
      onKeyDown: ({ event }) => {
        if (slashRef.current.items.length === 0 && event.key !== 'Escape') return false
        if (event.key === 'ArrowDown') {
          move(1)
          return true
        }
        if (event.key === 'ArrowUp') {
          move(-1)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = slashRef.current.items[slashRef.current.index]
          if (!item) return false
          slashRef.current.command(item)
          return true
        }
        if (event.key === 'Escape') {
          setSlash(null)
          return true
        }
        return false
      },
      onExit: () => setSlash(null),
    }
    claimSlashBridge(handlers)
    return () => releaseSlashBridge(handlers)
  }, [move])

  return { slash, pick, hover }
}
