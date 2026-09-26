import assert from 'node:assert/strict'
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads'
import { after, describe, it } from 'node:test'
import * as Y from 'yjs'
import { installBrowserGlobals } from './harness'

installBrowserGlobals()
;(globalThis as unknown as Record<string, unknown>).BroadcastChannel = NodeBroadcastChannel

const { openDatabase, closeDatabase } = await import('@/lib/db/dexie')
const { closePeerChannel, openPeerChannel } = await import('@/lib/db/peers')
const { applyRemoteUpdate, openDoc, readPlainText, releaseAll, whenPersisted, DOC_FIELD } = await import(
  '@/lib/db/ydoc'
)

/** This process is one tab; the channel below stands in for another tab of the
 *  same account, which shares the IndexedDB but has its own documents. */
const db = openDatabase('peers')
openPeerChannel('peers')
const otherTab = new NodeBroadcastChannel('jottr:peers:peers')

function nextMessage() {
  return new Promise<{ pageId: string; update: Uint8Array }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No message within 2s')), 2000)
    otherTab.onmessage = (event) => {
      clearTimeout(timer)
      resolve((event as { data: { pageId: string; update: Uint8Array } }).data)
    }
  })
}

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe('tabs of the same account', () => {
  after(async () => {
    otherTab.close()
    closePeerChannel()
    await whenPersisted()
    releaseAll()
    closeDatabase()
  })

  it('passes an edit made here to the other tabs', async () => {
    const handle = await openDoc('sent', { seed: true })
    await whenPersisted()
    const received = nextMessage()
    const paragraph = handle.doc.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement
    paragraph.insert(0, [new Y.XmlText('from this tab')])

    const message = await received
    assert.equal(message.pageId, 'sent')
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(handle.doc))
    Y.applyUpdate(copy, message.update)
    assert.match(readPlainText(copy), /from this tab/)
  })

  it('passes an edit this tab pulled from the server to the other tabs', async () => {
    const handle = await openDoc('pulled', { seed: true })
    await whenPersisted()

    // Only the leader tab pulls, so the others hear of the server's copy from it.
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(handle.doc))
    const paragraph = server.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement
    paragraph.insert(0, [new Y.XmlText('from another device')])
    const before = Y.encodeStateAsUpdate(handle.doc)
    const received = nextMessage()
    await applyRemoteUpdate('pulled', Y.encodeStateAsUpdate(server))

    const message = await received
    assert.equal(message.pageId, 'pulled')
    const copy = new Y.Doc()
    Y.applyUpdate(copy, before)
    Y.applyUpdate(copy, message.update)
    assert.match(readPlainText(copy), /from another device/)
  })

  it('shows an edit from another tab without storing or pushing it a second time', async () => {
    const handle = await openDoc('received', { seed: true })
    await whenPersisted()
    await db.docStates.update('received', { dirty: 0 })
    const deltasBefore = await db.docUpdates.where('pageId').equals('received').count()

    // The other tab has its own copy of the page, and types into it.
    const theirs = new Y.Doc()
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(handle.doc))
    const before = Y.encodeStateVector(theirs)
    const paragraph = theirs.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement
    paragraph.insert(0, [new Y.XmlText('from the other tab')])
    otherTab.postMessage({ pageId: 'received', update: Y.encodeStateAsUpdate(theirs, before) })

    await waitFor(() => /from the other tab/.test(readPlainText(handle.doc)))
    await whenPersisted()
    assert.equal(await db.docUpdates.where('pageId').equals('received').count(), deltasBefore)
    assert.equal((await db.docStates.get('received'))?.dirty, 0)
  })
})
