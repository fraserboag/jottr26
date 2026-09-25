'use client'

import { useSyncExternalStore } from 'react'

/** Which pages have their subpages showing in the sidebar. Only the sidebar
 *  changes it; nothing done in the editor opens a branch. Remembered per
 *  device in localStorage, as it always has been: which folders are open is a
 *  view preference, not page data. */

const KEY = 'jottr.expanded'
const EMPTY: ReadonlySet<string> = new Set()

let current: ReadonlySet<string> | null = null
const listeners = new Set<() => void>()

function snapshot(): ReadonlySet<string> {
  if (!current) {
    try {
      const raw = localStorage.getItem(KEY)
      current = new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      current = new Set()
    }
  }
  return current
}

function save(next: ReadonlySet<string>) {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    /* Ignore. */
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useExpanded(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY)
}

export function toggleExpanded(id: string) {
  const next = new Set(snapshot())
  if (next.has(id)) next.delete(id)
  else next.add(id)
  save(next)
}
