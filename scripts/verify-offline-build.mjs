import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'

// Exercise the actual emitted HTML and worker, not a hand-written fixture.
// In particular, compiler workers must embed the same manifest URL that the
// build hook wrote. A mismatch would otherwise silently retain the old shell.
const html = await readFile('.next/server/app/app.html', 'utf8')
const cachesByName = new Map()
const open = async (name) => {
  if (!cachesByName.has(name)) {
    const entries = new Map()
    cachesByName.set(name, {
      match: async (key) => entries.get(key)?.clone(),
      put: async (key, response) => entries.set(key, response.clone()),
      keys: async () => [...entries.keys()].map((key) => ({ url: new URL(key, 'https://jottr.test').href })),
    })
  }
  return cachesByName.get(name)
}
let offline = false
const worker = vm.createContext({
  self: { addEventListener() {}, location: { origin: 'https://jottr.test' } },
  caches: { open }, Headers, Response, URL, setTimeout,
  fetch: async (url) => {
    assert.ok(!offline, 'Offline launch must not require a dependency download')
    assert.ok(url.startsWith('/_next/static/'))
    const pathname = new URL(url, 'https://jottr.test').pathname
    return new Response(await readFile(path.join('.next', pathname.slice('/_next/'.length))))
  },
})
vm.runInContext(await readFile('public/sw.js', 'utf8'), worker)
const manifestUrl = worker.offlineManifestPath(html)
assert.ok(manifestUrl, 'Workspace HTML is missing its offline manifest')
const manifest = JSON.parse(await readFile(path.join('.next', manifestUrl.slice('/_next/'.length)), 'utf8'))
const assets = worker.readOfflineAssets(manifest)
assert.ok(assets.some((asset) => !html.includes(asset)), 'Editor must remain deferred')
await worker.storeShell('/app', new Response(html, { headers: { 'content-type': 'text/html' } }))
assert.ok(await (await open('jottr-shell-v3')).match('/app'))
offline = true
const deploymentId = html.match(/\bdata-dpl-id="([^"]+)"/)?.[1]
for (const asset of assets) {
  const request = deploymentId ? `${asset}?dpl=${deploymentId}` : asset
  const response = await worker.cacheFirst({ request, waitUntil() {} }, 'jottr-assets-v2')
  assert.equal(response.status, 200)
}
console.log(`Verified offline shell and ${assets.length} deferred editor assets`)
