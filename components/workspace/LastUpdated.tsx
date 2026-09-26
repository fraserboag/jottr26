'use client'

import { useEffect, useState } from 'react'

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

function describeEdit(at: number, now: number) {
  // An edit newer than the last tick reads as just now.
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return relative.format(-days, 'day')
  const date = new Date(at)
  return (date.getFullYear() === new Date(now).getFullYear() ? shortDate : longDate).format(date)
}

/** When the open page last changed, faintly in the bottom right. It mirrors
 *  the breadcrumb in the opposite corner — same size, padding and colour as
 *  the trail's last crumb — and lets clicks through. Left off touch screens,
 *  where the corner belongs to the page and the keyboard bar. Ticks every half minute so
 *  "just now" doesn't stay just now. */
export function LastUpdated({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (!at) return null
  return (
    <p
      title={fullTime.format(at)}
      className="pointer-events-none absolute right-2 bottom-2 z-20 flex h-8 select-none items-center px-2 text-faint pointer-coarse:hidden"
    >
      Last updated {describeEdit(at, now)}
    </p>
  )
}
