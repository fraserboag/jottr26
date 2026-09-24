'use client'

import { useEffect } from 'react'

/** Registers the service worker. A new build takes over on its own the next
 *  time the app is fully closed and reopened; nothing is announced. */
export function ServiceWorkerManager() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* An unregistered worker only costs offline support, never data. */
    })
  }, [])

  return null
}
