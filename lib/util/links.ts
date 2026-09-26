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
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** A dev server is this same workspace under another origin, so a page link
 *  copied from one — or written before page links went relative — still
 *  names one of your own pages, not someone else's. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost')
}

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
  const ours = url.origin === here.origin || isLoopback(url)
  if (pageId && ours && url.pathname === '/app') {
    return { kind: 'page', pageId }
  }

  // Same origin but not a page — /login, or /app with nothing open — falls
  // through to here on purpose. It is a real destination, just not one this
  // view can render in place, so it opens like any other outbound link.
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null
  return { kind: 'external', href: url.href }
}

/** `mailto:`, `tel:`, `https:` — anything already carrying a scheme. A real one
 *  is always followed by something, which is what keeps a page called
 *  'Meeting: agenda' from being read as an address. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\S/i

/** `example.com:8080` or `localhost:3000` — a host and port, which the URL
 *  parser would otherwise read as a scheme called `example.com:`. */
const HOST_PORT = /^(?:localhost|[^\s:/]*\.[^\s:/]+):\d+(?:[/?#]|$)/i

function hasScheme(value: string) {
  return SCHEME.test(value) && !HOST_PORT.test(value)
}

/** The href for a link to one of your own pages. Relative on purpose: the same
 *  note opens on a dev server and on the deployed app, and never sends you
 *  across origins to read a page this copy already has. */
export function pageHref(pageId: string): string {
  return `/app?p=${encodeURIComponent(pageId)}`
}

/** What a typed link field means. Bare hostnames get https, because that is
 *  what someone typing `example.com` into a link box wants; anything that
 *  already says where it is going — a scheme, or a path into this app — is
 *  left exactly as typed. */
export function normalizeHref(input: string): string {
  const value = input.trim()
  if (!value) return ''
  if (hasScheme(value) || value.startsWith('/')) return value
  return `https://${value}`
}

/** Whether what has been typed reads as a destination rather than a search.
 *  Only used to decide which suggestion to offer first — both are always
 *  offered, so guessing wrong costs an arrow key. */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (SCHEME.test(value) || value.startsWith('/')) return true
  // A bare host: no spaces, and a dot with something either side of it.
  return !/\s/.test(value) && /^[^\s.]+\.[^\s.]{2,}/.test(value)
}

/** A plain left click, the only kind a link is followed in place for. A held
 *  modifier or a middle click is the browser being asked for a tab or a window
 *  explicitly, and the anchor's real href does the right thing with it. */
export function isPlainLeftClick(event: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}
