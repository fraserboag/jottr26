/* Jottr service worker.
 *
 * Hand-written rather than generated: Next 16 builds with Turbopack, where the
 * usual webpack-based PWA plugins do not run, and a local-first app needs very
 * little from a service worker anyway. The notes live in IndexedDB; all this
 * has to do is make sure the shell and its chunks are on the device so the app
 * opens offline.
 */

const VERSION = 'v3'
const SHELL_CACHE = `jottr-shell-${VERSION}`
/** Not tied to VERSION. Everything in it is content-hashed, so an old entry is
 *  never wrong, and wiping it on an update left the new shell with none of its
 *  scripts on the next offline launch: a blank page. */
const ASSET_CACHE = 'jottr-assets-v2'
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE])

/** Cached at install so a freshly installed app works offline immediately,
 *  before the user has visited every route. */
const PAGES = ['/app', '/', '/login']
const FILES = ['/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png']

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
    (async () => {
      const assets = await caches.open(ASSET_CACHE)
      // Individually, so one 404 during a deploy cannot fail the whole install.
      await Promise.all([
        ...FILES.map((url) => assets.add(url).catch(() => undefined)),
        ...PAGES.filter((url) => url !== '/app').map((url) => cachePage(url).catch(() => undefined)),
        // Except the workspace: without it this worker cannot open the app
        // offline, so failing leaves the previous worker in charge until the
        // next visit tries again.
        cachePage('/app'),
      ])
    })(),
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
    event.respondWith(handleNavigation(event, url))
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
async function handleNavigation(event, url) {
  let response
  try {
    response = await fetch(event.request)
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const exact = await cache.match(url.pathname)
    if (exact) return exact

    // Any workspace URL falls back to the workspace shell: it is a client
    // component that reads the page id from the query string itself, so the
    // cached document is correct for every /app URL.
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      const shell = await cache.match('/app')
      if (shell) return shell
    }

    const root = await cache.match('/')
    if (root) return root

    return new Response(OFFLINE_FALLBACK, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  if (response.ok) event.waitUntil(storeShell(url.pathname, response.clone()).catch(() => undefined))
  return response
}

async function cachePage(path) {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  await storeShell(path, response)
}

/** Keeps an HTML page only once the scripts and styles it loads are cached
 *  too, since a page without them renders nothing. Keyed by path alone: the
 *  query never changes the document, and one copy per path means the page
 *  served offline is always the newest one seen. */
async function storeShell(path, response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return
  const html = await response.clone().text()
  const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? [])
  const assetCache = await caches.open(ASSET_CACHE)
  await Promise.all(
    [...assets].map(async (asset) => {
      if (await assetCache.match(asset)) return
      const fetched = await fetch(asset)
      if (!fetched.ok) throw new Error(`${asset}: ${fetched.status}`)
      await assetCache.put(asset, fetched)
    }),
  )
  const cache = await caches.open(SHELL_CACHE)
  await cache.put(path, response)
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
