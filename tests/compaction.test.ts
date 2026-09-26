import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Y from 'yjs'
import { installBrowserGlobals } from './harness'

installBrowserGlobals()

const { openDatabase, closeDatabase } = await import('@/lib/db/dexie')
const { openDoc, patchDocState, readPlainText, releaseAll, whenPersisted, DOC_FIELD } = await import(
  '@/lib/db/ydoc'
)

let device = 0

/** A fresh database and a new page, with a text node to type into. */
async function freshPage() {
  const db = openDatabase(`compaction-${device++}`)
  const handle = await openDoc('page', { seed: true })
  const paragraph = handle.doc.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement
  const text = new Y.XmlText()
  paragraph.insert(0, [text])
  return { db, doc: handle.doc, text }
}

/** Drop every in-memory document and read the page back off the disk. */
async function reload() {
  await whenPersisted()
  releaseAll()
  return (await openDoc('page')).doc
}

afterEach(() => {
  releaseAll()
  closeDatabase()
})

describe('delta compaction', () => {
  it('keeps every edit when the edits that cross the threshold land back to back', async () => {
    const { doc, text } = await freshPage()
    for (let i = 0; i < 400; i += 1) text.insert(text.length, 'x')

    const expected = readPlainText(doc)
    assert.equal(readPlainText(await reload()), expected)
  })

  it('keeps every edit when the server version is recorded in the middle of them', async () => {
    const { db, doc, text } = await freshPage()
    for (let i = 0; i < 400; i += 1) {
      text.insert(text.length, 'x')
      // What a pull does straight after merging: not awaited, so it races the
      // persistence of the edits around it the way it would in a tab.
      if (i % 7 === 0) void patchDocState(db, 'page', () => ({ version: i }))
    }

    const expected = readPlainText(doc)
    assert.equal(readPlainText(await reload()), expected)
  })

  it('leaves the page dirty and at its server version after compacting', async () => {
    const { db, text } = await freshPage()
    await patchDocState(db, 'page', () => ({ version: 7 }))
    for (let i = 0; i < 200; i += 1) text.insert(text.length, 'x')
    await whenPersisted()

    const state = await db.docStates.get('page')
    assert.equal(state?.version, 7)
    assert.equal(state?.dirty, 1)
    assert.ok((await db.docUpdates.where('pageId').equals('page').count()) < 150, 'it compacted')
  })
})
