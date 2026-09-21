/** Where a link inside a page should take you.
 *
 *  The workspace is one route with the open page in the query string, so a
 *  link to another note is this app's own /app?p=<id> URL. Those are followed
 *  in place: opening a tab would boot a second copy of the workspace to show a
 *  page this one already has loaded. Everything else leaves for a new tab. */
export type LinkTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'external'; href: string }

/** Page content arrives from other devices, so an href is untrusted input and
 *  `javascript:` must never reach `window.open`. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** `base` is the URL the link was clicked on — in the app, `location.href`.
 *  Taking it as an argument rather than reading `window` keeps this a pure
 *  function, which is what makes it testable under Node. */
export function resolveLink(href: string, base: string): LinkTarget | null {
  // An empty href resolves to the URL you are already on, which as a click
  // would silently reopen the current page.
  if (!href.trim()) return null

  let here: URL
  let url: URL
  try {
    here = new URL(base)
    url = new URL(href, base)
  } catch {
    return null
  }

  const pageId = url.searchParams.get('p')
  if (pageId && url.origin === here.origin && url.pathname === '/app') {
    return { kind: 'page', pageId }
  }

  // Same origin but not a page — /login, or /app with nothing open — falls
  // through to here on purpose. It is a real destination, just not one this
  // view can render in place, so it opens like any other outbound link.
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null
  return { kind: 'external', href: url.href }
}
