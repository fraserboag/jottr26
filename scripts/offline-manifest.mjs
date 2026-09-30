import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Next's dynamic-import manifest lists the complete chunk group, including
 * shared dependencies and CSS. Turbopack emits one per route; Webpack emits
 * one for the build. Read the workspace's version first, without parsing
 * either bundler's generated JavaScript or copying unrelated route bundles.
 *
 * @param {string} distDir
 * @param {string} manifestUrl
 */
export async function writeOfflineManifest(distDir, manifestUrl) {
  const candidates = [
    path.join(distDir, 'server/app/app/page/react-loadable-manifest.json'),
    path.join(distDir, 'react-loadable-manifest.json'),
  ]
  let manifest
  for (const file of candidates) {
    try {
      manifest = JSON.parse(await readFile(file, 'utf8'))
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (!manifest) throw new Error('Missing Next dynamic-import manifest for offline caching')

  const files = [...new Set(Object.values(manifest).flatMap((entry) => entry.files))].sort()
  // Fail the build rather than silently shipping a shell without its editor.
  if (!files.length || files.some((file) => typeof file !== 'string' || !/^static\/(chunks|css)\/[^?]+\.(js|css)$/.test(file) || file.split('/').includes('..'))) {
    throw new Error('Invalid or empty Next dynamic-import assets for offline caching')
  }
  await Promise.all(files.map((file) => stat(path.join(distDir, file))))

  if (!/^\/_next\/static\/jottr-offline\/[\w-]+\.json$/.test(manifestUrl)) {
    throw new Error('Invalid offline manifest URL')
  }
  const output = path.join(distDir, manifestUrl.slice('/_next/'.length))
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ version: 1, assets: files.map((file) => `/_next/${file}`) }))
}
