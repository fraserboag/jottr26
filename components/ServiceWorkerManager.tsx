'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'

/** Registers the service worker and, when a new build is waiting, offers the
 *  reload rather than taking it. Swapping the app out mid-sentence would be a
 *  strange thing to do to someone who is writing. */
export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    let reloading = false
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing)
            }
          })
        })
      })
      .catch(() => {
        /* An unregistered worker only costs offline support, never data. */
      })

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  if (!waiting) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 px-4">
      <div className="flex items-center gap-3 rounded-full border border-line bg-raised py-2 pl-4 pr-2 shadow-[var(--shadow-pop)]">
        <span className="text-ink">A new version of Jottr is ready.</span>
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
          className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-contrast"
        >
          <Icon name="refresh" size={13} />
          Reload
        </button>
      </div>
    </div>
  )
}
