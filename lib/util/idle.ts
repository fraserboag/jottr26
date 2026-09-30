/** Give a committed React view a paint opportunity before doing other work.
 * An animation-frame callback runs before paint, so wait for the next frame. */
export function afterPaint(callback: () => void): () => void {
  let cancelled = false
  let frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(() => {
      if (!cancelled) callback()
    })
  })
  return () => {
    cancelled = true
    window.cancelAnimationFrame(frame)
  }
}

/** Optional work can wait indefinitely for idle: opening a note loads its
 * editor directly. Older browsers get a short delay after the initial paint. */
export function idleAfterPaint(callback: () => void): () => void {
  let cancelled = false
  let idle: number | undefined
  let timer: number | undefined
  const run = () => { if (!cancelled) callback() }
  const cancelPaint = afterPaint(() => {
    if (typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function') {
      idle = window.requestIdleCallback(run)
    } else {
      timer = window.setTimeout(run, 500)
    }
  })
  return () => {
    cancelled = true
    cancelPaint()
    if (idle !== undefined) window.cancelIdleCallback(idle)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
