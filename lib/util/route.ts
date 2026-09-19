'use client'

import { useCallback, useSyncExternalStore } from 'react'

/** The workspace is one route with the open page in the query string.
 *
 *  Navigating between pages therefore never fetches a document or an RSC
 *  payload — it is a `pushState` and a re-render off IndexedDB. That is what
 *  makes clicking through the sidebar feel instant, and it is also what lets
 *  the service worker serve one cached shell for every /app URL when offline. */

const EVENT = 'jottr:navigate'

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener(EVENT, callback)
  }
}

const snapshot = () => window.location.search
const serverSnapshot = () => ''

export function useQuery() {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return new URLSearchParams(search)
}

export function useOpenPageId(): [string | null, (id: string | null, options?: { replace?: boolean }) => void] {
  const params = useQuery()
  const open = useCallback((id: string | null, options?: { replace?: boolean }) => {
    const next = new URLSearchParams(window.location.search)
    if (id) next.set('p', id)
    else next.delete('p')
    next.delete('new')
    const url = next.toString() ? `${window.location.pathname}?${next}` : window.location.pathname
    if (options?.replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [params.get('p'), open]
}
