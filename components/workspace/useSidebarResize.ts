'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WIDE_QUERY } from './useSidebarDrawer'

const WIDTH_KEY = 'jottr.sidebarWidth'

// The floor keeps the header's workspace button and the sync indicator side
// by side; the ceiling stops a drag from crowding out the page itself.
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 264

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

/** The wide sidebar's width, which its edge can be dragged to change, and
 *  which is kept for next time. */
export function useSidebarResize() {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{
    x: number
    width: number
    last: number
    pointerId: number
    handle: HTMLElement
  } | null>(null)

  // Read again whenever the screen crosses into or out of wide, as it always
  // has been.
  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY)
    const read = () => {
      let storedWidth: string | null = null
      try {
        storedWidth = localStorage.getItem(WIDTH_KEY)
      } catch {
        /* Ignore. */
      }
      // Clamped on the way in as well as out: a value left behind by an older
      // build, or by hand, should not be able to produce an unusable sidebar.
      const parsedWidth = Number(storedWidth)
      if (Number.isFinite(parsedWidth) && parsedWidth > 0) setWidth(clampWidth(parsedWidth))
    }
    read()
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])

  // Dragging the sidebar's edge works like dragging a table column. Once the
  // press lands on the handle, the rest of the drag is followed on the window
  // rather than on the handle, so it neither depends on pointer capture holding
  // nor on the handle still being on screen, and the width is only written
  // back once the drag ends.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = {
      x: event.clientX,
      width,
      last: width,
      pointerId: event.pointerId,
      handle: event.currentTarget,
    }
    setDragging(true)
    // Only keeps hover effects elsewhere from lighting up on the way past.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* Ignore. */
    }
  }

  // Every way a drag can finish comes through here, and more than one of them
  // can fire for the same release, so it does nothing once the drag is over.
  // Without a position to work from, the drag keeps the last width it showed.
  const endResize = useCallback((clientX?: number) => {
    const from = drag.current
    if (!from) return
    drag.current = null
    setDragging(false)
    // A drag given up on rather than released can leave the handle holding
    // the pointer, which would steer every later click back onto it.
    try {
      if (from.handle.hasPointerCapture(from.pointerId)) {
        from.handle.releasePointerCapture(from.pointerId)
      }
    } catch {
      /* Ignore. */
    }
    // Worked out from the release rather than read off `width`: releasing is a
    // discrete event and can land before the last move has rendered, which
    // would otherwise store a width a few pixels behind the one on screen.
    const final = clientX === undefined ? from.last : clampWidth(from.width + clientX - from.x)
    setWidth(final)
    try {
      localStorage.setItem(WIDTH_KEY, String(final))
    } catch {
      /* Ignore. */
    }
  }, [])

  // A release can go missing — let go over another window or the browser's
  // own chrome, a context menu or system gesture taking the pointer, capture
  // dropped along the way — and a drag that never hears it would otherwise
  // leave the whole app stuck showing the resize cursor until a reload. So
  // besides the release itself, a move with the button already up, the
  // window losing focus and the tab being hidden all end it too. Listened for
  // on the way down, so nothing in the page stopping an event can hide it,
  // and only for the pointer that started the drag.
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      const from = drag.current
      if (!from || event.pointerId !== from.pointerId) return
      if ((event.buttons & 1) === 0) {
        endResize()
        return
      }
      from.last = clampWidth(from.width + event.clientX - from.x)
      setWidth(from.last)
    }
    const release = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) endResize(event.clientX)
    }
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) endResize()
    }
    const abandon = () => endResize()
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('blur', abandon)
    document.addEventListener('visibilitychange', abandon)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('blur', abandon)
      document.removeEventListener('visibilitychange', abandon)
    }
  }, [dragging, endResize])

  return { width, dragging, startResize, endResize }
}
