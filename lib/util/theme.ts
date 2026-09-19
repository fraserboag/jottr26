'use client'

import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'jottr.theme'
const EVENT = 'jottr:theme'

/** The inline script in the document head has already applied the stored choice
 *  to <html> before first paint, so the DOM attribute is the source of truth and
 *  React can simply read it rather than re-deriving it after mount. */
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

const snapshot = (): Theme => {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

const serverSnapshot = (): Theme => 'system'

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot)

  const update = useCallback((next: Theme) => {
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', next)
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      /* Storage can be blocked; the theme still applies for this session. */
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return [theme, update]
}
