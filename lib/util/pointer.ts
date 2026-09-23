'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: coarse)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** True on a device whose main pointer is a finger: phones and tablets. The
 *  same test as Tailwind's `pointer-coarse:` variant, for the places where the
 *  difference is which component renders rather than how one is styled. */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
