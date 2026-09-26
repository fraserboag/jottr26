import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import * as Y from 'yjs'
import { FakeServer, installBrowserGlobals, setOnline } from './harness'

installBrowserGlobals()

const { openDatabase, closeDatabase, activeDatabase, eraseDatabase, databaseName } =
  await import('@/lib/db/dexie')
const { createPage, trashPage, restorePage, deleteForever, emptyTrash, movePage, refreshDerived, toggleFavorite } =
  await import('@/lib/db/pages')
const { openDoc, releaseAll, readTitle, readPlainText, onLocalEdit, whenPersisted, patchDocState, DOC_FIELD } =
  await import('@/lib/db/ydoc')
const { SyncEngine, countPending } = await import('@/lib/sync/engine')

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

  /** What a real tab's onLocalEdit listener does: recount the dirty rows so
   *  the reported phase catches up with what is actually on disk. */
  async noticeEdit() {
    await this.focus()
    await (this.engine as unknown as { refreshPending: () => Promise<void> }).refreshPending()
  }

  /** The phase the indicator would be showing right now. subscribe() hands the
   *  current status to a new listener before returning its own unsubscribe. */
  phase() {
    let phase = ''
    this.engine.subscribe((status) => {
      phase = status.phase
    })()
    return phase
  }

  /** Push without pulling first. This is the state a device is in when another
   *  device writes in the window between its own pull and push — the only way a
   *  compare-and-swap is ever rejected in practice. */
  async pushWithoutPulling() {
    await this.focus()
    await (this.engine as unknown as { push: (signal: AbortSignal) => Promise<void> }).push(
      new AbortController().signal,
    )
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
    return countPending(activeDatabase()!)
  }
}

/** Document persistence is fire-and-forget by design, so tests wait for the
 *  IndexedDB writes the update listener kicked off. */
const settle = () => whenPersisted()

let laptop: Device
let phone: Device

describe('local-first sync', () => {
  before(async () => {
    laptop = new Device('laptop')
    phone = new Device('phone')
  })

  after(() => {
    closeDatabase()
  })

  /** One page, passed back and forth between the two devices. These run in
   *  order and each builds on the state the one before left behind. */
  describe('one page on two devices, step by step', () => {
    let pageId: string

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
  })

  it('leaves page rows the server has not changed alone on the next pull', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Unchanged')
    await laptop.sync()
    // Pulled once, which takes the server's timestamps onto the row.
    await laptop.sync()

    // The overlap window hands this page back on every cycle. Writing it again
    // would wake every live query on the table for nothing.
    const db = activeDatabase()!
    let writes = 0
    const count = () => {
      writes += 1
    }
    db.pages.hook('updating', count)
    db.pages.hook('creating', count)
    try {
      await laptop.engine.syncOnce()
    } finally {
      db.pages.hook('updating').unsubscribe(count)
      db.pages.hook('creating').unsubscribe(count)
    }
    assert.equal(writes, 0)
  })

  it('reports a typed-but-unsynced page as pending rather than synced', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.sync()
    assert.equal(laptop.phase(), 'synced')

    await laptop.type(id, 'still only on this device')
    await laptop.noticeEdit()
    assert.equal(laptop.phase(), 'pending', 'an unsynced edit must not read as synced')

    await laptop.sync()
    assert.equal(laptop.phase(), 'synced', 'the push settles it')
  })

  it('keeps a document edited during its own push marked as pending', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.type(id, 'first')
    await laptop.sync()
    assert.equal(await laptop.pendingCount(), 0)

    // Typed while push_page_doc is on the wire: the server gets the state from
    // before it, so the document must still be waiting to go afterwards.
    await laptop.type(id, ' second')
    server.rpcDelayMs = 30
    const pushing = laptop.engine.syncOnce()
    while (server.rpcInFlight === 0) await new Promise((resolve) => setTimeout(resolve, 1))
    await laptop.type(id, ' third')
    await pushing
    server.rpcDelayMs = 0

    assert.equal(await laptop.pendingCount(), 1, 'the edit made mid-push is still pending')
    const pushed = new Y.Doc()
    Y.applyUpdate(pushed, Buffer.from(server.docs.get(id)!.ydoc, 'base64'))
    assert.doesNotMatch(readPlainText(pushed), /third/)

    await laptop.sync()
    assert.equal(await laptop.pendingCount(), 0)
    Y.applyUpdate(pushed, Buffer.from(server.docs.get(id)!.ydoc, 'base64'))
    assert.match(readPlainText(pushed), /first second third/)
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

    const tombstone = server.pages.get(id)
    assert.ok(tombstone?.purged_at, 'the row should stay behind as a tombstone')
    assert.equal(tombstone?.title, '', 'the tombstone should not keep the title')
    assert.equal(server.docs.has(id), false, 'the document should be gone')

    await phone.sync()
    assert.equal(await phone.page(id), undefined, 'the phone should drop it from its trash')
  })

  it('trashes, restores and purges a page together with everything under it', async () => {
    await laptop.focus()
    const parent = await createPage()
    const child = await createPage({ parentId: parent })
    const grandchild = await createPage({ parentId: child })
    const family = [parent, child, grandchild]
    await laptop.sync()

    await trashPage(parent)
    for (const id of family) assert.ok(((await laptop.page(id))?.deletedAt ?? 0) > 0)
    await restorePage(parent)
    for (const id of family) assert.equal((await laptop.page(id))?.deletedAt, 0)

    // Emptied offline: the purges wait on this device, then go on reconnect.
    await trashPage(parent)
    setOnline(false)
    await emptyTrash()
    for (const id of family) assert.equal(await laptop.page(id), undefined)
    assert.equal(await activeDatabase()!.purges.count(), 3)

    setOnline(true)
    await laptop.sync()
    assert.equal(await activeDatabase()!.purges.count(), 0)
    for (const id of family) assert.ok(server.pages.get(id)?.purged_at, 'purged on the server')
  })

  it('asks for a sync at once when a page is trashed, moved or deleted, but batches typing', async () => {
    await laptop.focus()
    const kinds: string[] = []
    const stop = onLocalEdit((kind) => kinds.push(kind))
    try {
      const parent = await createPage()
      const id = await createPage()
      assert.ok(kinds.includes('structure'), 'creating a page is urgent')

      kinds.length = 0
      await laptop.setTitle(id, 'Typed')
      assert.ok(kinds.length > 0 && kinds.every((kind) => kind === 'text'), 'typing a title is not')

      for (const act of [() => movePage(id, parent, 0), () => trashPage(id), () => deleteForever(id)]) {
        kinds.length = 0
        await act()
        assert.deepEqual([...new Set(kinds)], ['structure'])
      }
    } finally {
      stop()
    }
  })

  it('keeps a favourite starred on one device while another renames the page', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Starred')
    await laptop.sync()
    await phone.sync()

    await phone.setTitle(id, ' and renamed')

    await laptop.focus()
    await toggleFavorite(id)
    await laptop.sync()

    await phone.sync()
    assert.equal((await phone.page(id))?.isFavorite, 1, 'the phone should see the star')
    assert.equal(server.pages.get(id)?.is_favorite, true, "the phone's rename must not unstar it")
    assert.match(server.pages.get(id)?.title ?? '', /renamed/)
  })

  it('drops a page purged on another device before this one saw it trashed', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Test')
    await laptop.sync()
    await phone.sync()

    // Trashed and emptied from the trash without the phone syncing in between,
    // so the phone never sees the page in the trash at all.
    await laptop.focus()
    await trashPage(id)
    await emptyTrash()
    await laptop.sync()

    await phone.sync()
    assert.equal(await phone.page(id), undefined, 'the page should be gone from the phone')
  })

  it('does not bring back a purged page that another device was still editing', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Doomed')
    await laptop.sync()
    await phone.sync()

    await phone.setTitle(id, ' but renamed')
    await phone.type(id, 'typed on the phone')

    await laptop.focus()
    await trashPage(id)
    await emptyTrash()
    await laptop.sync()

    // The phone pushes before it pulls here, as it would if the purge landed
    // between its own pull and push.
    await phone.pushWithoutPulling()
    await phone.sync()

    assert.equal(phone.phase(), 'synced', 'the stale push must not wedge the phone in an error')
    assert.equal(await phone.page(id), undefined)
    assert.ok(server.pages.get(id)?.purged_at, 'the tombstone should survive the stale push')
    assert.equal(server.pages.get(id)?.title, '')
    assert.equal(server.docs.has(id), false, 'the document must not be recreated')
    assert.equal(await phone.pendingCount(), 0)

    await laptop.sync()
    assert.equal(await laptop.page(id), undefined)
  })

  it('keeps a trashing from one device and a move from the other', async () => {
    await laptop.focus()
    const parent = await createPage()
    const id = await createPage()
    await laptop.sync()
    await phone.sync()

    await laptop.focus()
    await trashPage(id)
    await laptop.sync()

    // The phone moves the page before it has heard about the trashing. Its
    // push must not carry the stale deletedAt back up with the move.
    await phone.focus()
    await movePage(id, parent, 0)
    await phone.sync()
    await laptop.sync()

    for (const device of [laptop, phone]) {
      const row = await device.page(id)
      assert.ok((row?.deletedAt ?? 0) > 0, `${device.name} should still have it in the trash`)
      assert.equal(row?.parentId, parent, `${device.name} should have the move`)
    }
    assert.ok(server.pages.get(id)?.deleted_at)
  })

  it('drops pages deleted from the server outright, but keeps ones not yet uploaded', async () => {
    await laptop.focus()
    const gone = await createPage()
    const tombstoned = await createPage()
    await laptop.sync()
    await phone.sync()
    assert.ok(await phone.page(gone))

    // A delete that left no tombstone, as every purge did before tombstones.
    server.pages.delete(gone)
    server.docs.delete(gone)
    // And a tombstone stamped before the phone's cursor, so no pull sees it.
    const row = server.pages.get(tombstoned)!
    server.pages.set(tombstoned, { ...row, purged_at: row.updated_at })

    await phone.focus()
    const fresh = await createPage()
    ;(phone.engine as unknown as { reconciledAt: number }).reconciledAt = 0
    await phone.sync()

    assert.equal(await phone.page(gone), undefined, 'the vanished page should be dropped')
    assert.equal(await phone.page(tombstoned), undefined, 'the purged page should be dropped')
    assert.ok(await phone.page(fresh), 'a page the server has never seen must survive')
  })

  it('pulls every changed page even when one changes between two page fetches', async () => {
    // More than one page of changes, as a first sync pulls.
    const ids: string[] = []
    for (let i = 0; i < 600; i++) {
      const id = `bulk-${String(i).padStart(3, '0')}`
      const at = server.stamp()
      server.pages.set(id, {
        id,
        user_id: 'u',
        title: id,
        parent_id: null,
        sort_key: `a${i}`,
        deleted_at: null,
        created_at: at,
        updated_at: at,
      })
      ids.push(id)
    }

    // Another device edits a page the first fetch already returned, which
    // moves it to the end of the order the pull is reading in.
    server.afterSelect = (table) => {
      if (table !== 'pages') return
      server.afterSelect = null
      const row = server.pages.get(ids[0])!
      server.pages.set(ids[0], { ...row, title: 'Edited', updated_at: server.stamp() })
    }

    const tablet = new Device('tablet')
    await tablet.sync()

    await tablet.focus()
    const pulled = await activeDatabase()!.pages.bulkGet(ids)
    assert.deepEqual(
      ids.filter((_, index) => !pulled[index]),
      [],
      'every page should arrive',
    )
    assert.equal(pulled[0]?.title, 'Edited')
  })

  it('keeps literal angle brackets in a title', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Using <b> tags')
    await laptop.sync()
    await phone.sync()

    // Titles are read through the text node's delta, not its serialised markup,
    // so typing a tag is just typing.
    assert.equal(await laptop.title(id), 'Using <b> tags')
    assert.equal(await phone.title(id), 'Using <b> tags')
  })

  it('pushes a title that reached the server inside the document before the row caught up', async () => {
    // A new page syncs at once, blank, and the title typed straight after
    // goes up with the document before the editor's debounce has mirrored it
    // onto the row.
    await laptop.focus()
    const id = await createPage()
    await laptop.sync()
    const handle = await openDoc(id)
    const title = handle.doc.getXmlFragment(DOC_FIELD).get(0) as Y.XmlElement
    handle.doc.transact(() => {
      title.insert(0, [new Y.XmlText('Holiday')])
    })
    await settle()
    await laptop.sync()

    // The debounce lands after the push, and the next pull must not put the
    // blank title from the server back.
    await refreshDerived(id)
    await laptop.sync()
    await laptop.sync()

    assert.equal(server.pages.get(id)?.title, 'Holiday')
    assert.equal((await laptop.page(id))?.title, 'Holiday')
  })

  it('marks a page pulled from the server as not yet carrying its document', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Later')
    await laptop.sync()

    await phone.sync()
    const row = await phone.page(id)
    assert.equal(row?.origin, 'remote', 'the phone did not write this page')

    await phone.focus()
    const state = await activeDatabase()!.docStates.get(id)
    assert.ok((state?.version ?? 0) > 0, 'its document arrived, so the editor may open it')
  })

  it('erases the local copy on sign-out', async () => {
    const Dexie = (await import('dexie')).default
    openDatabase('departing')
    const id = await createPage()
    await settle()
    assert.ok(await activeDatabase()!.pages.get(id))

    await eraseDatabase('departing')

    assert.equal(
      await Dexie.exists(databaseName('departing')),
      false,
      'no notes should be left behind for the next person to use this device',
    )
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

  it('resolves a manual sync once it has finished, with the result', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Synced by hand')

    const status = await laptop.engine.syncNow()

    assert.equal(status.phase, 'synced')
    assert.equal(server.pages.get(id)?.title, 'Synced by hand')
  })

  it('can cancel a sync the network never answers, and sync again after', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Stuck in a tunnel')

    server.stalled = true
    const pending = laptop.engine.syncNow()
    await new Promise((resolve) => setTimeout(resolve, 10))
    laptop.engine.cancelSync()
    const status = await pending
    server.stalled = false

    assert.notEqual(status.phase, 'error', 'a cancel is not a failure, and schedules no backoff')
    assert.equal(status.pending, 1, 'the page should still be waiting to upload')

    assert.equal((await laptop.engine.syncNow()).phase, 'synced', 'the cancelled sync must not block the next')
    assert.equal(server.pages.get(id)?.title, 'Stuck in a tunnel')
  })

  it('gives up on a sync the network never answers, and retries it', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Suspended mid-request')

    const internals = laptop.engine as unknown as {
      cycleTimeoutMs: number
      inFlight: boolean
      retryTimer: ReturnType<typeof setTimeout> | null
    }
    internals.cycleTimeoutMs = 30
    server.stalled = true
    await laptop.engine.syncOnce()
    server.stalled = false
    internals.cycleTimeoutMs = 90_000
    if (internals.retryTimer) clearTimeout(internals.retryTimer)

    assert.equal(laptop.phase(), 'error', 'a timeout is a failure, with a retry scheduled')
    assert.equal(internals.inFlight, false, 'the hung request must not hold later syncs')
    assert.equal((await laptop.engine.syncNow()).phase, 'synced')
    assert.equal(server.pages.get(id)?.title, 'Suspended mid-request')
  })

  it('has a tab that is not the leader ask the leader to push', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Typed in the other window')

    const sent: unknown[] = []
    const follower = new SyncEngine(server.client(), 'laptop') as unknown as {
      isLeader: boolean
      statusChannel: { postMessage: (message: unknown) => void }
      flushEdit: () => void
    }
    follower.isLeader = false
    follower.statusChannel = { postMessage: (message) => sent.push(message) }
    follower.flushEdit()
    assert.deepEqual(sent, [{ type: 'nudge' }], 'the other window should ask rather than wait')

    await laptop.focus()
    const leader = laptop.engine as unknown as {
      onStatusMessage: (message: unknown) => void
      current: Promise<void> | null
    }
    leader.onStatusMessage({ type: 'nudge' })
    assert.ok(leader.current, 'the leader should start a sync on the nudge')
    await leader.current
    assert.equal(server.pages.get(id)?.title, 'Typed in the other window')
  })

  it("pushes another tab's pull along with this tab's edit, rather than over it", async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.type(id, 'Laptop')
    await laptop.sync()
    await phone.sync()
    await phone.type(id, ' phone')
    await phone.sync()

    // This tab has the page open. The leader tab pulls the phone's edit onto
    // the disk they share, and this tab's copy of the document never hears.
    await laptop.focus()
    const db = activeDatabase()!
    const handle = await openDoc(id)
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Buffer.from(server.docs.get(id)!.ydoc, 'base64'))
    await db.docUpdates.add({ pageId: id, update: Y.encodeStateAsUpdate(remote, Y.encodeStateVector(handle.doc)) })
    await patchDocState(db, id, () => ({ version: server.docs.get(id)!.version }))

    // Then this tab becomes the leader, and the user types.
    const paragraph = handle.doc.getXmlFragment(DOC_FIELD).get(1) as Y.XmlElement
    handle.doc.transact(() => paragraph.insert(paragraph.length, [new Y.XmlText(' desk')]))
    await settle()
    await laptop.engine.syncOnce()

    const pushed = new Y.Doc()
    Y.applyUpdate(pushed, Buffer.from(server.docs.get(id)!.ydoc, 'base64'))
    assert.match(readPlainText(pushed), /phone/)
    assert.match(readPlainText(pushed), /desk/)
    assert.match(readPlainText(handle.doc), /phone/, 'the open page should show it too')
  })

  it('polls every 10 seconds while realtime is down, and every 45 once it is up', async () => {
    const internals = laptop.engine as unknown as {
      realtimeUp: boolean
      lastRunAt: number
      poll: () => void
      request?: () => void
    }
    let asked = 0
    internals.request = () => {
      asked += 1
    }
    try {
      internals.realtimeUp = false
      internals.lastRunAt = Date.now() - 10_000
      internals.poll()
      assert.equal(asked, 1, 'nothing else will announce a write while realtime is down')

      internals.realtimeUp = true
      internals.poll()
      assert.equal(asked, 1, 'realtime is up and a sync ran 10 seconds ago')

      internals.lastRunAt = Date.now() - 45_000
      internals.poll()
      assert.equal(asked, 2, 'the backstop poll still runs')
    } finally {
      delete internals.request
      internals.realtimeUp = false
    }
  })

  it("skips realtime's echo of this device's own saves, but not another device's", async () => {
    const internals = laptop.engine as unknown as {
      subscribeRealtime: () => void
      dropRealtime: () => void
      realtimeTimer: ReturnType<typeof setTimeout> | null
    }
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Echo')
    server.realtimeHandlers = []
    internals.subscribeRealtime()
    const [fire] = server.realtimeHandlers
    const event = () => ({ new: { id, updated_at: server.pages.get(id)!.updated_at } })

    try {
      // The row upsert and the document save each stamp the page; both come back.
      await laptop.sync()
      fire(event())
      assert.equal(internals.realtimeTimer, null, 'its own save starts no cycle')

      await phone.sync()
      await phone.type(id, ' from the phone')
      await phone.sync()
      await laptop.focus()
      fire(event())
      assert.notEqual(internals.realtimeTimer, null, "the phone's save does")
    } finally {
      if (internals.realtimeTimer) clearTimeout(internals.realtimeTimer)
      internals.realtimeTimer = null
      internals.dropRealtime()
    }
  })

  it('pushes several documents at once, and stops cleanly when one fails', async () => {
    await laptop.focus()
    const ids: string[] = []
    for (let i = 0; i < 6; i += 1) ids.push(await createPage())

    server.rpcDelayMs = 20
    server.maxRpcInFlight = 0
    try {
      await laptop.sync()
      assert.ok(server.maxRpcInFlight > 1, 'documents should go up side by side')
      assert.ok(server.maxRpcInFlight <= 4, 'but only a few at a time')
      for (const id of ids) assert.ok(server.docs.has(id))

      for (const id of ids) await laptop.type(id, 'more')
      server.failDocPush = ids[0]
      await laptop.sync()
      assert.equal(laptop.phase(), 'error')
      const internals = laptop.engine as unknown as { retryTimer: ReturnType<typeof setTimeout> | null }
      if (internals.retryTimer) clearTimeout(internals.retryTimer)
    } finally {
      server.failDocPush = null
      server.rpcDelayMs = 0
    }

    await laptop.sync()
    assert.equal(laptop.phase(), 'synced')
    assert.equal(await laptop.pendingCount(), 0)
    await phone.sync()
    for (const id of ids) assert.match(await phone.text(id), /more/, 'every document should reach the phone')
  })

  it('does not start a cancelled manual sync that was queued behind another', async () => {
    await laptop.focus()
    const id = await createPage()
    await laptop.setTitle(id, 'Still in the tunnel')

    server.stalled = true
    laptop.engine.request()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const manual = laptop.engine.syncNow()
    await new Promise((resolve) => setTimeout(resolve, 10))
    laptop.engine.cancelSync()
    await manual
    await new Promise((resolve) => setTimeout(resolve, 10))

    const internals = laptop.engine as unknown as { inFlight: boolean }
    assert.equal(internals.inFlight, false, 'cancel must not leave a fresh sync hanging on the network')

    server.stalled = false
    assert.equal((await laptop.engine.syncNow()).phase, 'synced')
    assert.equal(server.pages.get(id)?.title, 'Still in the tunnel')
  })
})
