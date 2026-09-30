import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { writeOfflineManifest } from '../scripts/offline-manifest.mjs'

const url = '/_next/static/jottr-offline/test-build.json'

async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jottr-manifest-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function put(dir: string, file: string, content: unknown) {
  const target = path.join(dir, file)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content))
}

describe('offline build manifest', () => {
  it('includes the complete Webpack lazy chunk group, including shared code and CSS', async () => fixture(async (dir) => {
    const files = ['static/chunks/editor.js', 'static/chunks/shared.js', 'static/css/editor.css']
    await put(dir, 'react-loadable-manifest.json', { editor: { files }, shared: { files: [files[1]] } })
    await Promise.all(files.map((file) => put(dir, file, 'asset')))
    await writeOfflineManifest(dir, url)
    const manifest = JSON.parse(await readFile(path.join(dir, url.slice('/_next/'.length)), 'utf8'))
    assert.deepEqual(manifest, { version: 1, assets: [...files].sort().map((file) => `/_next/${file}`) })
  }))

  it('uses the Turbopack workspace manifest without including other routes', async () => fixture(async (dir) => {
    await put(dir, 'server/app/app/page/react-loadable-manifest.json', { editor: { files: ['static/chunks/editor.js'] } })
    await put(dir, 'react-loadable-manifest.json', { other: { files: ['static/chunks/unrelated.js'] } })
    await put(dir, 'static/chunks/editor.js', 'asset')
    await writeOfflineManifest(dir, url)
    const manifest = JSON.parse(await readFile(path.join(dir, url.slice('/_next/'.length)), 'utf8'))
    assert.deepEqual(manifest.assets, ['/_next/static/chunks/editor.js'])
  }))

  it('fails the build if Next emits no lazy chunks instead of silently losing offline support', async () => fixture(async (dir) => {
    await put(dir, 'react-loadable-manifest.json', {})
    await assert.rejects(writeOfflineManifest(dir, url), /empty/)
  }))

  it('fails the build when a listed dependency is missing', async () => fixture(async (dir) => {
    await put(dir, 'react-loadable-manifest.json', { editor: { files: ['static/chunks/missing.js'] } })
    await assert.rejects(writeOfflineManifest(dir, url), /ENOENT/)
  }))

  it('rejects paths outside the build assets', async () => fixture(async (dir) => {
    await put(dir, 'react-loadable-manifest.json', { editor: { files: ['static/chunks/../../private.js'] } })
    await assert.rejects(writeOfflineManifest(dir, url), /Invalid/)
  }))
})
