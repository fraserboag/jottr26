'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import { useScrollFade } from '@/components/editor/useScrollFade'
import { Icon } from '@/components/ui/Icon'
import type { PageRow } from '@/lib/db/schema'

/** The ancestors, then the page itself as plain unclickable text to close
 *  the trail. Most pages are top level and get no trail at all. The crumbs
 *  are plain text, and hovering underlines one the way a link would. On a
 *  wide screen a deep trail cuts the titles short. On a narrow screen it
 *  won't fit either, so rather than cutting the titles short it scrolls
 *  sideways, starting at the right-hand end with the open page, and the
 *  reader swipes back for the rest, its ends fading out as the mobile
 *  toolbar's do while there is more past them. */
export function Breadcrumb({
  trail,
  onOpen,
  truncate = false,
}: {
  trail: PageRow[]
  onOpen: (id: string | null) => void
  truncate?: boolean
}) {
  const navRef = useRef<HTMLElement | null>(null)
  const fade = useScrollFade()
  const setNav = useCallback(
    (nav: HTMLElement | null) => {
      navRef.current = nav
      fade(nav)
    },
    [fade],
  )
  // Keyed on the titles as well as the ids, so renaming a page, which changes
  // how wide the trail is, puts the open page back in view.
  const trailKey = trail.map((crumb) => `${crumb.id}:${crumb.title}`).join('/')

  // Starts the scrolling trail at its end. It happens again when the width
  // changes, such as when the phone turns, but not while the reader is only
  // swiping along it.
  useLayoutEffect(() => {
    const nav = navRef.current
    if (truncate || !nav) return
    const pin = () => {
      nav.scrollLeft = nav.scrollWidth
    }
    pin()
    const observer = new ResizeObserver(pin)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [truncate, trailKey])

  return (
    <nav
      ref={setNav}
      aria-label="Breadcrumb"
      className={`pointer-events-auto flex h-8 min-w-0 items-center gap-1.5 text-[14.5px] ${
        truncate
          ? 'overflow-hidden'
          : 'scroll-fade overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }`}
    >
      {trail.map((crumb, index) => (
        <span
          key={crumb.id}
          className={`flex items-center gap-1.5 ${truncate ? 'min-w-0' : 'shrink-0 whitespace-nowrap'}`}
        >
          {index > 0 && <Icon name="chevronRight" size={12} className="text-faint" />}
          {index === trail.length - 1 ? (
            <span aria-current="page" className={`text-faint ${truncate ? 'truncate' : ''}`}>
              {crumb.title || 'Untitled'}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(crumb.id)}
              className={`text-muted underline-offset-2 hover:underline ${truncate ? 'truncate' : ''}`}
            >
              {crumb.title || 'Untitled'}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}
