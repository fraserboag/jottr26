import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ORIGIN = 'https://jottr.test'
const DAY = 24 * 60 * 60 * 1000

/** The Cache API, as far as the worker uses it: keyed by URL. */
class FakeCache {
  entries = new Map<string, Response>()
  private url = (key: string | { url: string }) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }
  async match(key: string | { url: string }) {
    return this.entries.get(this.url(key))?.clone()
  }
  async put(key: string | { url: string }, response: Response) {
    this.entries.set(this.url(key), response)
  }
  async delete(key: string | { url: string }) {
    return this.entries.delete(this.url(key))
  }
}

/** public/sw.js itself, run as the classic script a worker is, with its
 *  top-level functions read back off the sandbox. */
const worker = vm.createContext({
  self: { addEventListener: () => {}, location: { origin: ORIGIN } },
  caches: {},
  Headers,
  Response,
  URL,
  fetch: () => Promise.reject(new Error('offline')),
  setTimeout,
})
vm.runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), worker)
const pruneAssets = worker.pruneAssets as (assets: FakeCache, shells: FakeCache, now?: number) => Promise<void>
const cacheFirst = worker.cacheFirst as (event: unknown, name: string) => Promise<Response>
const handleNavigation = worker.handleNavigation as (event: unknown, url: URL) => Promise<Response>

const asset = (stored?: number) =>
  new Response('chunk', { headers: stored === undefined ? {} : { 'x-jottr-stored': String(stored) } })
const stampOf = async (cache: FakeCache, path: string) =>
  Number((await cache.match(path))?.headers.get('x-jottr-stored'))

describe('service worker asset cache', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')

  async function pruned() {
    const shells = new FakeCache()
    await shells.put('/app', new Response('<script src="/_next/static/chunks/app-new.js"></script>'))
    const assets = new FakeCache()
    await assets.put('/_next/static/chunks/app-new.js', asset(now - 90 * DAY))
    await assets.put('/_next/static/chunks/app-old.js', asset(now - 31 * DAY))
    await assets.put('/_next/static/chunks/editor.js', asset(now - 2 * DAY))
    await assets.put('/_next/static/chunks/unstamped.js', asset())
    await assets.put('/icons/icon-192.png', asset(now - 400 * DAY))
    await pruneAssets(assets, shells, now)
    return assets
  }

  it('drops a chunk no cached page loads once it has gone unused for 30 days', async () => {
    assert.equal(await (await pruned()).match('/_next/static/chunks/app-old.js'), undefined)
  })

  it('keeps a chunk a cached page loads, however old', async () => {
    assert.ok(await (await pruned()).match('/_next/static/chunks/app-new.js'))
  })

  it('keeps a chunk no page names that was used recently, such as the editor', async () => {
    assert.ok(await (await pruned()).match('/_next/static/chunks/editor.js'))
  })

  it('keeps an old lazy chunk required by a cached shell, even when unused for months', async () => {
    const shells = new FakeCache()
    const assets = new FakeCache()
    const manifest = '/_next/static/jottr-offline/build-old.json'
    await shells.put('/app', new Response(`<meta name="jottr-offline-manifest" content="${manifest}">`))
    await assets.put(manifest, new Response(JSON.stringify({ version: 1, assets: ['/_next/static/chunks/editor-old.js'] })))
    await assets.put('/_next/static/chunks/editor-old.js', asset(now - 90 * DAY))
    await assets.put('/_next/static/chunks/unused.js', asset(now - 90 * DAY))

    await pruneAssets(assets, shells, now)
    assert.ok(await assets.match('/_next/static/chunks/editor-old.js'))
    assert.ok(await assets.match(manifest))
    assert.equal(await assets.match('/_next/static/chunks/unused.js'), undefined)
  })

  it('prunes old deployment aliases without dropping the current alias or canonical chunk', async () => {
    const shells = new FakeCache()
    const assets = new FakeCache()
    const chunk = '/_next/static/chunks/app.js'
    await shells.put('/app', new Response(`<script src="${chunk}?dpl=current"></script>`))
    for (const key of [chunk, `${chunk}?dpl=current`, `${chunk}?dpl=previous`]) {
      await assets.put(key, asset(now - 90 * DAY))
    }
    await pruneAssets(assets, shells, now)
    assert.ok(await assets.match(chunk))
    assert.ok(await assets.match(`${chunk}?dpl=current`))
    assert.equal(await assets.match(`${chunk}?dpl=previous`), undefined)
  })

  it('stamps a chunk stored before stamps existed, rather than dropping it', async () => {
    const assets = await pruned()
    assert.equal(await stampOf(assets, '/_next/static/chunks/unstamped.js'), now)
  })

  it('leaves the icons alone', async () => {
    assert.ok(await (await pruned()).match('/icons/icon-192.png'))
  })

  it('marks a chunk as used when it is served from the cache', async () => {
    const assets = new FakeCache()
    await assets.put('/_next/static/chunks/editor.js', asset(Date.now() - 2 * DAY))
    worker.caches = { open: async () => assets }
    const writes: Promise<unknown>[] = []
    const event = { request: { url: `${ORIGIN}/_next/static/chunks/editor.js` }, waitUntil: (p: Promise<unknown>) => writes.push(p) }

    const served = await cacheFirst(event, 'jottr-assets-v2')
    assert.equal(await served.text(), 'chunk')
    await Promise.all(writes)
    assert.ok(Date.now() - (await stampOf(assets, '/_next/static/chunks/editor.js')) < 1000)
    assert.equal(await (await assets.match('/_next/static/chunks/editor.js'))!.text(), 'chunk')
  })

  it('serves a precached lazy chunk offline when Next appends a deployment query', async () => {
    const assets = new FakeCache()
    await assets.put('/_next/static/chunks/editor.js', asset(Date.now()))
    worker.caches = { open: async () => assets }
    worker.fetch = () => Promise.reject(new Error('offline'))
    const response = await cacheFirst({ request: { url: `${ORIGIN}/_next/static/chunks/editor.js?dpl=deploy-a` }, waitUntil: () => {} }, 'jottr-assets-v2')
    assert.equal(await response.text(), 'chunk')
  })

  it('still serves queried assets cached by the previous worker', async () => {
    const assets = new FakeCache()
    await assets.put('/_next/static/chunks/editor.js?dpl=deploy-a', asset(Date.now()))
    worker.caches = { open: async () => assets }
    worker.fetch = () => Promise.reject(new Error('offline'))
    const response = await cacheFirst({ request: { url: `${ORIGIN}/_next/static/chunks/editor.js?dpl=deploy-a` }, waitUntil: () => {} }, 'jottr-assets-v2')
    assert.equal(await response.text(), 'chunk')
  })
})

describe('service worker navigation', () => {
  /** One cache per name, shared by every open, as the real Cache API is. */
  function storage() {
    const named = new Map<string, FakeCache>()
    const open = async (name: string) => named.get(name) ?? named.set(name, new FakeCache()).get(name)!
    worker.caches = { open }
    return open
  }

  const navigate = (path: string) => {
    const waits: Promise<unknown>[] = []
    const event = { request: { url: `${ORIGIN}${path}`, mode: 'navigate' }, waitUntil: (p: Promise<unknown>) => waits.push(p) }
    return { served: handleNavigation(event, new URL(path, ORIGIN)), waits }
  }

  it('opens the workspace from the device without waiting on a network that barely answers', async () => {
    const open = storage()
    await (await open('jottr-shell-v3')).put('/app', new Response('cached shell'))
    worker.fetch = () => new Promise(() => {})

    const { served } = navigate('/app?page=abc')
    const response = await Promise.race([served, new Promise<null>((resolve) => setTimeout(resolve, 100, null))])
    assert.equal(await response?.text(), 'cached shell')
  })

  it('still keeps the network copy of the workspace for the next launch', async () => {
    const open = storage()
    await (await open('jottr-shell-v3')).put('/app', new Response('cached shell'))
    worker.fetch = async () => new Response('new shell', { headers: { 'content-type': 'text/html' } })

    const { served, waits } = navigate('/app')
    assert.equal(await (await served).text(), 'cached shell')
    await Promise.all(waits)
    assert.equal(await (await (await open('jottr-shell-v3')).match('/app'))?.text(), 'new shell')
  })

  it('keeps opening the old shell while a new build downloads its editor', async () => {
    const open = storage()
    const shells = await open('jottr-shell-v3')
    await shells.put('/app', new Response('cached shell'))
    const manifest = '/_next/static/jottr-offline/build-new.json'
    const html = `<meta name="jottr-offline-manifest" content="${manifest}">`
    let finishDownload!: (response: Response) => void
    const download = new Promise<Response>((resolve) => { finishDownload = resolve })
    let downloading!: () => void
    const started = new Promise<void>((resolve) => { downloading = resolve })
    worker.fetch = async (request: unknown) => {
      if (request === manifest) return new Response(JSON.stringify({ version: 1, assets: ['/_next/static/chunks/editor-new.js'] }))
      if (typeof request === 'string') {
        downloading()
        return (await download).clone()
      }
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    }

    const { served, waits } = navigate('/app')
    assert.equal(await (await served).text(), 'cached shell')
    await started
    assert.equal(await (await shells.match('/app'))?.text(), 'cached shell')
    const reopening = navigate('/app?p=note')
    assert.equal(await (await reopening.served).text(), 'cached shell')

    finishDownload(new Response('editor code'))
    await Promise.all([...waits, ...reopening.waits])
    assert.equal(await (await shells.match('/app'))?.text(), html)
    assert.equal(await (await (await open('jottr-assets-v2')).match('/_next/static/chunks/editor-new.js'))?.text(), 'editor code')
  })

  it('leaves the working shell in place when a new build is missing a chunk', async () => {
    const open = storage()
    const shells = await open('jottr-shell-v3')
    await shells.put('/app', new Response('cached shell'))
    const manifest = '/_next/static/jottr-offline/build-new.json'
    worker.fetch = async (request: unknown) => {
      if (request === manifest) return new Response(JSON.stringify({ version: 1, assets: ['/_next/static/chunks/missing.js'] }))
      return typeof request === 'string'
        ? new Response('missing', { status: 404 })
        : new Response(`<meta name="jottr-offline-manifest" content="${manifest}">`, { headers: { 'content-type': 'text/html' } })
    }

    const { served, waits } = navigate('/app')
    assert.equal(await (await served).text(), 'cached shell')
    await Promise.all(waits)
    assert.equal(await (await shells.match('/app'))?.text(), 'cached shell')
  })

  it('keeps the old shell if its new build manifest cannot be downloaded', async () => {
    const open = storage()
    const shells = await open('jottr-shell-v3')
    await shells.put('/app', new Response('cached shell'))
    worker.fetch = async (request: unknown) => typeof request === 'string'
      ? new Response('missing', { status: 404 })
      : new Response('<meta name="jottr-offline-manifest" content="/_next/static/jottr-offline/missing.json">', { headers: { 'content-type': 'text/html' } })
    const { served, waits } = navigate('/app')
    assert.equal(await (await served).text(), 'cached shell')
    await Promise.all(waits)
    assert.equal(await (await shells.match('/app'))?.text(), 'cached shell')
  })

  it('refuses a malformed manifest without fetching off-origin dependencies', async () => {
    const open = storage()
    const shells = await open('jottr-shell-v3')
    const assets = await open('jottr-assets-v2')
    const manifest = '/_next/static/jottr-offline/bad.json'
    await shells.put('/app', new Response('cached shell'))
    const fetched: unknown[] = []
    worker.fetch = async (request: unknown) => {
      fetched.push(request)
      return typeof request === 'string'
        ? new Response(JSON.stringify({ version: 1, assets: ['https://other.test/editor.js'] }))
        : new Response(`<meta content="${manifest}" name="jottr-offline-manifest">`, { headers: { 'content-type': 'text/html' } })
    }
    const { waits } = navigate('/app')
    await Promise.all(waits)
    assert.equal(await (await shells.match('/app'))?.text(), 'cached shell')
    assert.equal(await assets.match(manifest), undefined)
    assert.equal(fetched.length, 2)
  })

  it('uses a cached build manifest and its chunks without downloading them again', async () => {
    const open = storage()
    const assets = await open('jottr-assets-v2')
    const manifest = '/_next/static/jottr-offline/build-cached.json'
    const html = `<meta name="jottr-offline-manifest" content="${manifest}">`
    await assets.put(manifest, new Response(JSON.stringify({ version: 1, assets: ['/_next/static/chunks/editor-cached.js'] })))
    await assets.put('/_next/static/chunks/editor-cached.js', asset())
    worker.fetch = async (request: unknown) => {
      assert.notEqual(typeof request, 'string', 'Cached dependencies should not be fetched')
      return new Response(html, { headers: { 'content-type': 'text/html' } })
    }
    const { waits } = navigate('/app')
    await Promise.all(waits)
    assert.equal(await (await (await open('jottr-shell-v3')).match('/app'))?.text(), html)
  })

  it('preserves the shell deployment query when downloading its lazy dependencies', async () => {
    const open = storage()
    const manifest = '/_next/static/jottr-offline/build-a.json'
    const html = `<script src="/_next/static/chunks/app.js?dpl=deploy-a"></script><meta name="jottr-offline-manifest" content="${manifest}">`
    const fetched: string[] = []
    worker.fetch = async (request: unknown) => {
      if (typeof request !== 'string') return new Response(html, { headers: { 'content-type': 'text/html' } })
      fetched.push(request)
      return request === manifest
        ? new Response(JSON.stringify({ version: 1, assets: ['/_next/static/chunks/editor.js'] }))
        : new Response('chunk')
    }
    const { waits } = navigate('/app')
    await Promise.all(waits)
    assert.ok(fetched.includes('/_next/static/chunks/editor.js?dpl=deploy-a'))
    assert.ok(await (await open('jottr-assets-v2')).match('/_next/static/chunks/editor.js'))
    // The previous worker remains active while this worker waits to activate.
    // It must be able to read the newly adopted shell with exact URL lookups.
    const assets = await open('jottr-assets-v2')
    worker.fetch = () => Promise.reject(new Error('offline'))
    for (const chunk of ['app', 'editor']) {
      const request = `/_next/static/chunks/${chunk}.js?dpl=deploy-a`
      assert.equal(await (await assets.match(request))?.text(), 'chunk')
      assert.equal(await (await cacheFirst({ request, waitUntil: () => {} }, 'jottr-assets-v2')).text(), 'chunk')
    }
    assert.equal(await (await (await open('jottr-shell-v3')).match('/app'))?.text(), html)
  })

  it('adds the exact deployment alias when the canonical dependency is already cached', async () => {
    const open = storage()
    const assets = await open('jottr-assets-v2')
    const chunk = '/_next/static/chunks/app.js'
    await assets.put(chunk, asset(Date.now()))
    worker.fetch = async (request: unknown) => {
      assert.notEqual(typeof request, 'string', 'Cached dependencies should not be fetched')
      return new Response(`<script src="${chunk}?dpl=new-build"></script>`, { headers: { 'content-type': 'text/html' } })
    }
    const { waits } = navigate('/app')
    await Promise.all(waits)
    assert.equal(await (await assets.match(`${chunk}?dpl=new-build`))?.text(), 'chunk')
  })

  it('refreshes the shared workspace shell when opened with a trailing slash', async () => {
    const open = storage()
    await (await open('jottr-shell-v3')).put('/app', new Response('cached shell'))
    worker.fetch = async () => new Response('new shell', { headers: { 'content-type': 'text/html' } })

    const { served, waits } = navigate('/app/?p=note')
    assert.equal(await (await served).text(), 'cached shell')
    await Promise.all(waits)
    assert.equal(await (await (await open('jottr-shell-v3')).match('/app'))?.text(), 'new shell')
  })

  it('waits on the network for a workspace never cached', async () => {
    storage()
    worker.fetch = async () => new Response('from network', { headers: { 'content-type': 'text/html' } })

    const { served } = navigate('/app')
    assert.equal(await (await served).text(), 'from network')
  })
})
