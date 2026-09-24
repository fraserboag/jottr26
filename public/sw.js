/* Jottr service worker.
 *
 * Hand-written rather than generated: Next 16 builds with Turbopack, where the
 * usual webpack-based PWA plugins do not run, and a local-first app needs very
 * little from a service worker anyway. The notes live in IndexedDB; all this
 * has to do is make sure the shell and its chunks are on the device so the app
 * opens offline.
 */

const VERSION = 'v2'
const SHELL_CACHE = `jottr-shell-${VERSION}`
const ASSET_CACHE = `jottr-assets-${VERSION}`
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE])

/** Cached at install so a freshly installed app works offline immediately,
 *  before the user has visited every route. */
const SHELL = ['/app', '/', '/login', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png']

const OFFLINE_FALLBACK = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Jottr is offline</title><style>
:root{color-scheme:light dark}
body{margin:0;display:grid;place-items:center;min-height:100svh;padding:24px;
font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
background:#fff;color:#1f1f1e;text-align:center}
@media(prefers-color-scheme:dark){body{background:#1a1a19;color:#ececea}}
p{max-width:30ch;color:#6f6e6a}</style></head>
<body><div><h1>Offline</h1><p>Jottr hasn't finished caching this page yet. Reconnect once and it will work offline from then on.</p></div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Individually, so one 404 during a deploy cannot fail the whole install.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
    ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => !KEEP.has(name)).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

// The page asks for this once the user accepts an update, never automatically:
// swapping the shell out from under someone mid-sentence is not an improvement.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname === '/icon.svg'

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Supabase, and anything else off-origin, is never touched: an auth token or
  // a stale note blob served from cache would be a genuine bug.
  if (url.origin !== self.location.origin) return

  // React Server Component payloads must always be live or absent.
  if (url.searchParams.has('_rsc')) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }

  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE))
  }
})

/** Network first, so a deploy is picked up on the next load; cache second, so
 *  being offline is unremarkable. */
async function handleNavigation(request, url) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const exact = await cache.match(request, { ignoreSearch: true })
    if (exact) return exact

    // Any workspace URL falls back to the workspace shell: it is a client
    // component that reads the page id from the query string itself, so the
    // cached document is correct for every /app URL.
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      const shell = await cache.match('/app', { ignoreSearch: true })
      if (shell) return shell
    }

    const root = await cache.match('/', { ignoreSearch: true })
    if (root) return root

    return new Response(OFFLINE_FALLBACK, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

/** Safe because these URLs are content-hashed by the build. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => hit)
  return hit ?? network
}
