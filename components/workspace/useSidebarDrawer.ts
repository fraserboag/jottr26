'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Wide enough for the sidebar to sit beside the page rather than over it. */
export const WIDE_QUERY = '(min-width: 880px)'

/** Whether the screen is wide, and whether the sidebar is showing: always
 *  beside the page on a wide screen, and a drawer over it on a narrow one. */
export function useSidebarDrawer() {
  const [wide, setWide] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY)
    let cold = true
    const apply = () => {
      setWide(media.matches)
      // A phone opening the app cold lands on the page list, since picking a
      // page is the first thing to do there. Narrowing a window later is not
      // a fresh start, and gets the page to itself. A wide screen always has
      // the sidebar: there is no way to hide it there.
      setSidebarOpen(media.matches || cold)
      cold = false
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  // Leaving for another page from the open drawer waits for the drawer to
  // finish sliding shut. iOS takes the picture it shows during a swipe back at
  // the moment the history entry is pushed, so pushing any earlier would have
  // the drawer reappear on the page being swiped back to.
  const pending = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pending.current), [])
  const afterDrawerShuts = useCallback(
    (go: () => void) => {
      window.clearTimeout(pending.current)
      if (wide || !sidebarOpen) {
        go()
        return
      }
      setSidebarOpen(false)
      // The slide's 200ms, and a little over for its last frame to be shown.
      pending.current = window.setTimeout(go, 250)
    },
    [wide, sidebarOpen],
  )

  return { wide, sidebarOpen, setSidebarOpen, afterDrawerShuts }
}
