import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Y from 'yjs'
import { installBrowserGlobals } from './harness'

installBrowserGlobals()

const { openDatabase, closeDatabase, databaseName, eraseDatabase } = await import('@/lib/db/dexie')
const { default: Dexie } = await import('dexie')
const { openDoc, patchDocState, readPlainText, releaseAll, saveFailure, whenPersisted, DOC_FIELD } = await import(
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

  it('keeps a delta another tab wrote that this tab never applied', async () => {
    const { db, doc, text } = await freshPage()
    await whenPersisted()
    const theirs = new Y.Doc()
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(doc))
    const before = Y.encodeStateVector(theirs)
    const paragraph = theirs.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement
    paragraph.insert(0, [new Y.XmlText('from the leader tab')])
    await db.docUpdates.add({ pageId: 'page', update: Y.encodeStateAsUpdate(theirs, before) })

    for (let i = 0; i < 200; i += 1) text.insert(text.length, 'x')
    await whenPersisted()

    assert.ok((await db.docUpdates.where('pageId').equals('page').count()) < 150, 'it compacted')
    assert.match(readPlainText(await reload()), /from the leader tab/)
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

describe('where the compacted page is kept', () => {
  const rows = (db: ReturnType<typeof openDatabase>) => db.docUpdates.where('pageId').equals('page').count()

  it('keeps it out of the row every edit rewrites', async () => {
    const { db, text } = await freshPage()
    for (let i = 0; i < 200; i += 1) text.insert(text.length, 'x')
    await whenPersisted()

    assert.equal((await db.docStates.get('page'))?.snapshot.byteLength, 0)
    assert.ok((await rows(db)) < 150, 'it compacted')
    assert.equal(readPlainText(await reload()), '\n' + 'x'.repeat(200) + '\n')
  })

  it("moves a page an older build compacted out of that row on the first edit, and not before", async () => {
    const db = openDatabase(`compaction-${device++}`)
    const old = new Y.Doc()
    const paragraph = new Y.XmlElement('paragraph')
    old.getXmlFragment(DOC_FIELD).insert(0, [new Y.XmlElement('title'), paragraph])
    paragraph.insert(0, [new Y.XmlText('from the old build')])
    await db.docStates.put({ pageId: 'page', snapshot: Y.encodeStateAsUpdate(old), version: 3, dirty: 0, edits: 5 })

    const handle = await openDoc('page')
    await whenPersisted()
    assert.ok((await db.docStates.get('page'))!.snapshot.byteLength > 0, 'opening alone writes nothing')

    const text = (handle.doc.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement).get(0) as Y.XmlText
    text.insert(text.length, ', and this one')
    await whenPersisted()

    const state = (await db.docStates.get('page'))!
    assert.equal(state.snapshot.byteLength, 0)
    assert.deepEqual([state.version, state.dirty, state.edits], [3, 1, 6])
    assert.equal(readPlainText(await reload()), '\nfrom the old build, and this one\n')
  })

  it('reads a page an older build compacted after this one did', async () => {
    const { db, text } = await freshPage()
    for (let i = 0; i < 200; i += 1) text.insert(text.length, 'x')
    await whenPersisted()

    // What an older build's compaction does: the page into the snapshot, and
    // every row, this build's compacted one included, deleted.
    const copy = new Y.Doc()
    for (const row of await db.docUpdates.where('pageId').equals('page').toArray()) Y.applyUpdate(copy, row.update)
    await db.docStates.update('page', { snapshot: Y.encodeStateAsUpdate(copy) })
    await db.docUpdates.where('pageId').equals('page').delete()

    assert.equal(readPlainText(await reload()), '\n' + 'x'.repeat(200) + '\n')
  })
})

describe('opening a page', () => {
  it('seeds a new page when another load of it is already running', async () => {
    openDatabase(`compaction-${device++}`)
    const [, handle] = await Promise.all([openDoc('page'), openDoc('page', { seed: true })])
    assert.equal(handle.doc.getXmlFragment(DOC_FIELD).length, 2)
  })
})

describe('a database the browser closes', () => {
  const saved = (db: ReturnType<typeof openDatabase>) => db.docUpdates.where('pageId').equals('page').count()

  it('saves an edit made after the browser dropped the connection', async () => {
    const { db, text } = await freshPage()
    await whenPersisted()
    const before = await saved(db)
    // What Dexie does when the browser closes the connection under it.
    db.close({ disableAutoOpen: false })

    text.insert(0, 'typed after')
    await whenPersisted()
    assert.equal(await saved(db), before + 1)
    assert.equal(saveFailure(), null)
    assert.match(readPlainText(await reload()), /typed after/)
  })

  it('writes nothing after this app closed it, as on signing out', async () => {
    const { text } = await freshPage()
    await whenPersisted()
    closeDatabase()

    text.insert(0, 'typed after')
    await whenPersisted()
    assert.equal(saveFailure(), null)
  })

  it('keeps saving once another tab has upgraded it to a newer version', async () => {
    const { db, text } = await freshPage()
    await whenPersisted()
    const before = await saved(db)
    const newer = new Dexie(databaseName(`compaction-${device - 1}`))
    newer.version(9).stores({ docUpdates: '++seq, pageId' })
    await newer.open()
    newer.close()

    text.insert(0, 'typed after')
    await whenPersisted()
    assert.equal(await saved(db), before + 1)
    assert.equal(saveFailure(), null)
  })
})

describe('signing out', () => {
  it('saves edits to a page whose load was still running when the account signed out and back in', async () => {
    openDatabase('signed-out')
    const loading = openDoc('page')
    releaseAll()
    await loading.catch(() => {})
    await eraseDatabase('signed-out')

    const db = openDatabase('signed-out')
    await openDoc('page', { seed: true })
    await whenPersisted()
    assert.ok((await db.docUpdates.where('pageId').equals('page').count()) > 0)
    assert.equal((await db.docStates.get('page'))?.dirty, 1)
  })
})
