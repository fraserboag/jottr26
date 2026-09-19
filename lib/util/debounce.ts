export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  const wrapped = (...args: A) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = lastArgs!
      lastArgs = null
      fn(...a)
    }, ms)
  }

  wrapped.flush = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    const a = lastArgs!
    lastArgs = null
    fn(...a)
  }

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }

  return wrapped
}
