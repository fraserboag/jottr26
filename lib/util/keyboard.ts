'use client'

/** Brings the keyboard up now, for an editor that has not mounted yet.
 *
 *  iOS only raises the keyboard for a focus made inside the tap itself. A new
 *  page's title is focused once the page has been written to IndexedDB and its
 *  editor built, well after the tap, and from there the keyboard comes up
 *  sometimes, not at all, or with its top strip drawn as a blank grey box.
 *  Moving focus between two editable elements while the keyboard is already up
 *  is allowed, though. So the tap focuses an invisible stand-in, and the
 *  editor takes over from it when it focuses its title.
 *
 *  Call it synchronously at the top of the tap's handler: after an await it is
 *  too late. */
export function raiseKeyboard() {
  if (!window.matchMedia('(pointer: coarse)').matches) return

  const standIn = document.createElement('div')
  standIn.contentEditable = 'true'
  // The same as the editor's own, so the keyboard does not change layout at
  // the handover.
  standIn.spellcheck = true
  standIn.setAttribute('autocapitalize', 'sentences')
  standIn.setAttribute('aria-hidden', 'true')
  standIn.tabIndex = -1
  // Invisible but still focusable, which `display: none` would not be. Pinned
  // to the top so iOS has nothing to scroll into view, and 16px so it has no
  // reason to zoom.
  standIn.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;overflow:hidden;pointer-events:none;'
  document.body.appendChild(standIn)

  // Gone as soon as anything else has focus, the editor or otherwise. If the
  // page never opens, the keyboard goes back down rather than staying up over
  // nothing.
  const timer = window.setTimeout(() => standIn.blur(), 3000)
  standIn.addEventListener(
    'blur',
    () => {
      window.clearTimeout(timer)
      standIn.remove()
    },
    { once: true },
  )
  standIn.focus({ preventScroll: true })
}
