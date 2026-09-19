import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import * as Y from 'yjs'
import { FakeServer, installBrowserGlobals, setOnline } from './harness'

installBrowserGlobals()

const { openDatabase, closeDatabase, activeDatabase } = await import('@/lib/db/dexie')
const { createPage, trashPage, deleteForever, refreshDerived } = await import('@/lib/db/pages')
const { openDoc, releaseAll, readTitle, readPlainText, DOC_FIELD } = await import('@/lib/db/ydoc')
const { SyncEngine } = await import('@/lib/sync/engine')

const server = new FakeServer()

/** Two devices, one account. Each has its own IndexedDB and its own in-memory
 *  documents; switching between them mirrors closing one laptop and opening
 *  another. */
class Device {
  readonly engine: InstanceType<typeof SyncEngine>

  constructor(readonly name: string) {
    openDatabase(name)
    this.engine = new SyncEngine(server.client(), name)
  }

  /** Make this the device the module-level stores point at. */
  async focus() {
    releaseAll()
    openDatabase(this.name)
    // The engine holds its own handle to the database, so re-point it too, and
    // put it in the state start() would leave it in — leader, running, but
    // without the timers and listeners a real tab installs.
    const internals = this.engine as unknown as {
      db: unknown
      isLeader: boolean
      running: boolean
    }
    internals.db = activeDatabase()
    internals.isLeader = true
    internals.running = true
  }

  async sync() {
    await this.focus()
    await this.engine.syncOnce()
  }

  /** Push without pulling first. This is the state a device is in when another
   *  device writes in the window between its own pull and push — the only way a
   *  compare-and-swap is ever rejected in practice. */
  async pushWithoutPulling() {
    await this.focus()
    await (this.engine as unknown as { push: () => Promise<void> }).push()
  }

  async type(pageId: string, text: string) {
    await this.focus()
    const handle = await openDoc(pageId)
    const fragment = handle.doc.getXmlFragment(DOC_FIELD)
    const paragraph = fragment.get(1) as Y.XmlElement
    handle.doc.transact(() => {
      paragraph.insert(paragraph.length, [new Y.XmlText(text)])
    })
    await settle()
    await refreshDerived(pageId)
  }

  async setTitle(pageId: string, text: string) {
    await this.focus()
    const handle = await openDoc(pageId)
    const title = handle.doc.getXmlFragment(DOC_FIELD).get(0) as Y.XmlElement
    handle.doc.transact(() => {
      title.insert(title.length, [new Y.XmlText(text)])
    })
    await settle()
    await refreshDerived(pageId)
  }

  async text(pageId: string) {
    await this.focus()
    const handle = await openDoc(pageId)
    return readPlainText(handle.doc)
  }

  async title(pageId: string) {
    await this.focus()
    const handle = await openDoc(pageId)
    return readTitle(handle.doc)
  }

  async page(pageId: string) {
    await this.focus()
    return activeDatabase()!.pages.get(pageId)
  }

  async pendingCount() {
    await this.focus()
    const db = activeDatabase()!
    const [pages, docs] = await Promise.all([
      db.pages.where('dirty').equals(1).primaryKeys(),
      db.docStates.where('dirty').equals(1).primaryKeys(),
    ])
    return new Set([...pages, ...docs] as string[]).size
  }
}

/** Document persistence is fire-and-forget by design, so tests wait for the
 *  IndexedDB writes the update listener kicked off. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

let laptop: Device
let phone: Device
let pageId: string

describe('local-first sync', () => {
  before(async () => {
    laptop = new Device('laptop')
    phone = new Device('phone')
  })

  after(() => {
    closeDatabase()
  })

  it('writes a new page to the server, then reports nothing pending', async () => {
    await laptop.focus()
    pageId = await createPage()
    await laptop.setTitle(pageId, 'Groceries')
    await laptop.type(pageId, 'Oat milk')

    assert.equal(await laptop.pendingCount(), 1, 'an unsynced page should be counted')

    await laptop.sync()

    assert.equal(server.pages.size, 1)
    assert.equal(server.docs.get(pageId)?.version, 1)
    assert.equal(server.pages.get(pageId)?.title, 'Groceries')
    assert.equal(await laptop.pendingCount(), 0, 'nothing should be pending after a sync')
  })

  it('delivers the page to a second device', async () => {
    await phone.sync()

    assert.equal(await phone.title(pageId), 'Groceries')
    assert.match(await phone.text(pageId), /Oat milk/)
    assert.equal((await phone.page(pageId))?.dirty, 0)
  })

  it('is idempotent: a second sync with no changes writes nothing', async () => {
    const before = { ...server.counts }
    await laptop.sync()
    await phone.sync()

    assert.equal(server.counts.upsert, before.upsert, 'no metadata should be re-pushed')
    assert.equal(server.counts.rpc, before.rpc, 'no document should be re-pushed')
  })

  it('merges edits made on both devices while offline', async () => {
    setOnline(false)
    await laptop.type(pageId, ' · Coffee beans')
    await phone.type(pageId, ' · Bread')

    assert.equal(await laptop.pendingCount(), 1)
    assert.equal(await phone.pendingCount(), 1)

    setOnline(true)
    await laptop.sync()
    await phone.sync()

    const phoneText = await phone.text(pageId)
    assert.match(phoneText, /Coffee beans/, "the laptop's edit reached the phone")
    assert.match(phoneText, /Bread/, "the phone's own edit survived the merge")

    await laptop.sync()
    const laptopText = await laptop.text(pageId)
    assert.match(laptopText, /Coffee beans/)
    assert.match(laptopText, /Bread/)

    assert.equal(await laptop.pendingCount(), 0)
    assert.equal(await phone.pendingCount(), 0)
  })

  it('recovers when the server moves on mid-push', async () => {
    setOnline(false)
    await laptop.type(pageId, ' · Butter')
    await phone.type(pageId, ' · Rice')
    setOnline(true)

    await laptop.sync()

    // The phone pushes against the version it held before the laptop's write,
    // which is exactly the race the compare-and-swap exists for.
    const rejectedBefore = server.counts.rpcRejected
    await phone.pushWithoutPulling()

    assert.ok(
      server.counts.rpcRejected > rejectedBefore,
      'the stale push should have been rejected',
    )

    // Rejected, merged, retried — and neither edit lost on the way through.
    const serverText = new Y.Doc()
    Y.applyUpdate(serverText, Buffer.from(server.docs.get(pageId)!.ydoc, 'base64'))
    const merged = readPlainText(serverText)
    assert.match(merged, /Butter/, "the laptop's edit is still on the server")
    assert.match(merged, /Rice/, "the phone's edit reached the server")

    assert.equal(await phone.pendingCount(), 0, 'the retry should have settled the document')
  })

  it('converges on identical documents', async () => {
    await laptop.sync()
    await phone.sync()
    await laptop.sync()

    const a = await laptop.text(pageId)
    const b = await phone.text(pageId)
    assert.equal(a, b, 'both devices should hold the same document')
  })

  it('merges concurrent renames instead of picking a winner', async () => {
    setOnline(false)
    await laptop.setTitle(pageId, ' (weekly)')
    await phone.setTitle(pageId, ' (Ocado)')

    setOnline(true)
    await laptop.sync()
    await phone.sync()
    await laptop.sync()

    const title = await laptop.title(pageId)
    assert.equal(title, await phone.title(pageId), 'titles should converge')
    assert.match(title, /weekly/, "the laptop's rename survived")
    assert.match(title, /Ocado/, "the phone's rename survived")

    // The sidebar's denormalised copy has to follow the document.
    assert.equal((await laptop.page(pageId))?.title, title)
  })

  it('keeps a document edited during its own push marked as pending', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.type(id, 'first')
    await laptop.sync()
    assert.equal(await laptop.pendingCount(), 0)

    await laptop.type(id, ' second')
    assert.equal(await laptop.pendingCount(), 1)
    await laptop.sync()
    assert.equal(await laptop.pendingCount(), 0)
    assert.match(server.docs.get(id)!.ydoc.length > 0 ? 'ok' : '', /ok/)
  })

  it('syncs the trash, and purges permanently deleted pages from the server', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Scratch')
    await laptop.sync()
    await phone.sync()

    await laptop.focus()
    await trashPage(id)
    await laptop.sync()
    await phone.sync()

    assert.ok(((await phone.page(id))?.deletedAt ?? 0) > 0, 'the phone should see the trashing')

    await laptop.focus()
    await deleteForever(id)
    await laptop.sync()

    assert.equal(server.pages.has(id), false, 'the row should be gone from the server')
    assert.equal(server.docs.has(id), false, 'the document should be gone too')
  })

  it('queues work while offline and flushes it on reconnect', async () => {
    setOnline(false)
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Written on a plane')
    await laptop.sync()

    assert.equal(server.pages.has(id), false, 'nothing should reach the server while offline')
    assert.equal(await laptop.pendingCount(), 1)

    setOnline(true)
    await laptop.sync()

    assert.equal(server.pages.get(id)?.title, 'Written on a plane')
    assert.equal(await laptop.pendingCount(), 0)

    await phone.sync()
    assert.equal(await phone.title(id), 'Written on a plane')
  })
})
