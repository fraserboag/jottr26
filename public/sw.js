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

/** Every deploy brings new chunks, and the old ones would otherwise stay on
 *  the device for good. A chunk goes once no cached page loads it and it has
 *  not been used for this long. Not on age alone: the editor is its own chunk
 *  that no page's HTML names, and it is kept by being used. */
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
/** A chunk in use is re-stamped at most this often, not on every load. */
const RESTAMP_AFTER_MS = 24 * 60 * 60 * 1000
const STORED_HEADER = 'x-jottr-stored'
const ASSET_PATTERN = /\/_next\/static\/[^"'\\\s)]+/g

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

/** Content-hashed by the build, so a cached copy is never out of date. */
const isStaticAsset = (url) => url.pathname.startsWith('/_next/static/')

/** Kept for offline, but under a fixed name, so a changed one has to be
 *  fetched again rather than served from the cache for good. */
const isFixedFile = (url) =>
  url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/') || url.pathname === '/icon.svg'

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
    event.respondWith(cacheFirst(event, ASSET_CACHE))
    return
  }

  if (isFixedFile(url)) {
    event.respondWith(staleWhileRevalidate(event, ASSET_CACHE))
  }
})

/** How long opening the app waits on the network before using the copy on the
 *  device. Offline fails at once; this is for the connection that is there
 *  but barely — one bar, a captive portal — which would otherwise hold a blank
 *  screen until the browser gave up, though every note is already local. */
const NAVIGATION_TIMEOUT_MS = 3000

/** Network first, so a deploy is picked up on the next load; cache second, so
 *  being offline, or nearly, is unremarkable. */
async function handleNavigation(event, url) {
  const network = fetch(event.request)
  // Registered now, while the event is live: an answer that arrives after the
  // cached copy was shown still refreshes it for next time.
  event.waitUntil(
    network
      .then((response) => (response.ok ? storeShell(url.pathname, response.clone()) : undefined))
      .catch(() => undefined),
  )

  const slow = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null))
  try {
    const response = await Promise.race([network, slow])
    if (response) return response
  } catch {
    return (await cachedPage(url)) ?? offlinePage()
  }

  // Still waiting: the copy on the device if there is one, else the network.
  const cached = await cachedPage(url)
  if (cached) return cached
  return network.catch(() => offlinePage())
}

async function cachedPage(url) {
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

  return (await cache.match('/')) ?? null
}

function offlinePage() {
  return new Response(OFFLINE_FALLBACK, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
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
  const assets = new Set(html.match(ASSET_PATTERN) ?? [])
  const assetCache = await caches.open(ASSET_CACHE)
  await Promise.all(
    [...assets].map(async (asset) => {
      if (await assetCache.match(asset)) return
      const fetched = await fetch(asset)
      if (!fetched.ok) throw new Error(`${asset}: ${fetched.status}`)
      await assetCache.put(asset, stamped(fetched))
    }),
  )
  const cache = await caches.open(SHELL_CACHE)
  await cache.put(path, response)
  // Only once a fresh shell is in, so what it loads is never mistaken for
  // something no page needs.
  if (Date.now() - lastPruned > RESTAMP_AFTER_MS) {
    lastPruned = Date.now()
    await pruneAssets(assetCache, cache)
  }
}

let lastPruned = 0

/** A copy of the response carrying the time it was stored. Headers on a
 *  fetched response cannot be changed, so it is rebuilt around the body. */
function stamped(response, now = Date.now()) {
  const headers = new Headers(response.headers)
  headers.set(STORED_HEADER, String(now))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** Drops chunks that no cached page loads and that have not been used for
 *  PRUNE_AFTER_MS. One stored before stamps existed is stamped now rather than
 *  dropped, so it too gets the full time. Icons and the manifest stay. */
async function pruneAssets(assetCache, shellCache, now = Date.now()) {
  const referenced = new Set()
  for (const request of await shellCache.keys()) {
    const page = await shellCache.match(request)
    const html = page ? await page.text() : ''
    for (const asset of html.match(ASSET_PATTERN) ?? []) {
      const url = new URL(asset, request.url)
      referenced.add(url.pathname + url.search)
    }
  }

  for (const request of await assetCache.keys()) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/_next/static/') || referenced.has(url.pathname + url.search)) continue
    const hit = await assetCache.match(request)
    if (!hit) continue
    const stored = Number(hit.headers.get(STORED_HEADER))
    if (!stored) await assetCache.put(request, stamped(hit, now))
    else if (now - stored > PRUNE_AFTER_MS) await assetCache.delete(request)
  }
}

/** Safe because these URLs are content-hashed by the build. */
async function cacheFirst(event, cacheName) {
  const { request } = event
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) {
    // Marked as in use, which is what keeps a chunk no page's HTML names.
    if (!(Date.now() - Number(hit.headers.get(STORED_HEADER)) < RESTAMP_AFTER_MS)) {
      event.waitUntil(cache.put(request, stamped(hit.clone())))
    }
    return hit
  }
  const response = await fetch(request)
  // Kept alive until written: the worker can be stopped once it has answered.
  if (response.ok) event.waitUntil(cache.put(request, stamped(response.clone())))
  return response
}

async function staleWhileRevalidate(event, cacheName) {
  const { request } = event
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
    .catch(() => hit)
  // Kept alive until written, as in cacheFirst: answered from the cache, the
  // worker could otherwise be stopped before the fresh copy is stored.
  event.waitUntil(network.catch(() => undefined))
  return hit ?? network
}
