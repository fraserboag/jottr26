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
})
