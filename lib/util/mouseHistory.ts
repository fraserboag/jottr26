/** Safari web apps can receive side-button clicks without navigating. Handle
 *  them here; other browsers keep their native back/forward behavior. */
export function listenForMouseHistory(target: Window): (() => void) | undefined {
  if (target.navigator.vendor !== 'Apple Computer, Inc.') return

  let sideButton: number | null = null

  function cancel(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function down(event: MouseEvent) {
    let step = 0
    if (event.button === 3) step = -1
    else if (event.button === 4) step = 1
    // Older WebKit reports both side buttons as middle clicks. The pressed
    // buttons mask still distinguishes them from an actual middle click.
    // https://bugs.webkit.org/show_bug.cgi?id=280755
    else if (event.button === 1 && event.buttons === 8) step = -1
    else if (event.button === 1 && event.buttons === 16) step = 1

    sideButton = step ? event.button : null
    if (!step) return
    cancel(event)
    target.history.go(step)
  }

  function release(event: MouseEvent) {
    if (event.button === 3 || event.button === 4 || event.button === sideButton) {
      // Cancel the release and auxiliary click too, so a side button cannot
      // also open a link or trigger another native history traversal.
      cancel(event)
    }
  }

  function reset() {
    sideButton = null
  }

  target.addEventListener('mousedown', down, true)
  target.addEventListener('mouseup', release, true)
  target.addEventListener('auxclick', release, true)
  target.addEventListener('blur', reset)
  return () => {
    target.removeEventListener('mousedown', down, true)
    target.removeEventListener('mouseup', release, true)
    target.removeEventListener('auxclick', release, true)
    target.removeEventListener('blur', reset)
  }
}
