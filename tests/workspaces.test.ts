import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { FakeServer, installBrowserGlobals } from './harness'

installBrowserGlobals()
const { default: Dexie } = await import('dexie')

const { openDatabase, closeDatabase, databaseName } = await import('@/lib/db/dexie')
const { createPage, restorePage, trashPage, emptyTrash, movePage, movePageToWorkspace, dropRelative, liveChildren, toggleFavorite } = await import('@/lib/db/pages')
const { createWorkspace, deleteWorkspace, restoreWorkspace, purgeWorkspace, updateWorkspace, reorderWorkspace, workspaceOrder } = await import('@/lib/db/workspaces')
const { whenPersisted, releaseAll } = await import('@/lib/db/ydoc')
const { SyncEngine, countPending } = await import('@/lib/sync/engine')
const { newId } = await import('@/lib/util/id')

afterEach(async () => { await whenPersisted(); releaseAll(); closeDatabase() })

describe('workspaces', () => {
  it('migrates live and trashed pages without changing IDs, links, order or pending edits', async () => {
    const userId = newId()
    const legacy = new Dexie(databaseName(userId))
    legacy.version(2).stores({
      pages: 'id, parentId, dirty, updatedAt, deletedAt, [deletedAt+parentId]',
      docStates: 'pageId, dirty', docUpdates: '++seq, pageId', purges: 'id', meta: 'key',
    })
    const old = {
      id: 'parent', title: 'Personal', parentId: '', sortKey: 'a0', isFavorite: 1,
      deletedAt: 0, createdAt: 1, updatedAt: 2, serverUpdatedAt: 0,
      dirty: 1, dirtyFields: ['title'], origin: 'local',
    }
    await legacy.table('pages').bulkAdd([old, { ...old, id: 'child', parentId: 'parent', deletedAt: 3 }])
    legacy.close()
    const db = openDatabase(userId)
    assert.equal(await db.workspaces.count(), 1)
    assert.equal((await db.workspaces.get(userId))?.name, 'Pages')
    assert.deepEqual(await db.pages.get('parent'), { ...old, workspaceId: userId, workspaceDeletionId: '' })
    assert.equal((await db.pages.get('child'))?.parentId, 'parent')
    assert.equal((await db.pages.get('child'))?.deletedAt, 3)
  })

  it('removes stored colours while preserving pending names, ordering and new workspaces', async () => {
    const userId = newId()
    const legacy = new Dexie(databaseName(userId))
    legacy.version(3).stores({
      pages: 'id, workspaceId, parentId, dirty, updatedAt, deletedAt, [deletedAt+parentId], [workspaceId+deletedAt+parentId]',
      docStates: 'pageId, dirty', docUpdates: '++seq, pageId', purges: 'id', meta: 'key',
      workspaces: 'id, dirty, deletedAt, createdAt', workspaceOperations: '++seq, workspaceId',
    })
    const base = {
      name: 'Pages', sortKey: 'a0', createdAt: 1, updatedAt: 3,
      serverUpdatedAt: 2, deletedAt: 0, purgedAt: 0, stateToken: '', dirty: 1,
    }
    const mixed = { ...base, id: userId, name: 'Personal', dirtyFields: ['name', 'sortKey'] }
    const colourOnly = { ...base, id: newId(), name: 'Work', dirty: 0, dirtyFields: [] }
    const unsynced = { ...base, id: newId(), name: 'New', serverUpdatedAt: 0, dirtyFields: [] }
    await legacy.table('workspaces').bulkAdd([
      { ...mixed, color: 'blue', dirtyFields: ['name', 'color', 'sortKey'] },
      { ...colourOnly, color: 'red', dirty: 1, dirtyFields: ['color'] },
      { ...unsynced, color: 'green', dirtyFields: ['color'] },
    ])
    legacy.close()

    const db = openDatabase(userId)
    assert.deepEqual(await db.workspaces.get(mixed.id), mixed)
    assert.deepEqual(await db.workspaces.get(colourOnly.id), colourOnly)
    assert.deepEqual(await db.workspaces.get(unsynced.id), unsynced)
  })

  it('starts with one Pages workspace and validates names', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    assert.equal((await db.workspaces.get(userId))?.name, 'Pages')
    assert.equal(await countPending(db), 0)
    const work = await createWorkspace(' Work ')
    assert.equal((await db.workspaces.get(work))?.name, 'Work')
    await assert.rejects(createWorkspace('work'), /already exists/)
    await assert.rejects(createWorkspace('  '), /Enter a space name/)
    await updateWorkspace(work, { name: 'Business' })
    assert.equal((await db.workspaces.get(work))?.name, 'Business')
    await assert.rejects(updateWorkspace(work, { name: 'pages' }), /already exists/)
  })

  it('recovers offline name collisions without blocking page and document uploads', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const server = new FakeServer()
    const engine = new SyncEngine(server.client(userId), userId) as unknown as {
      pull: (signal: AbortSignal) => Promise<unknown>; push: (signal: AbortSignal) => Promise<void>
    }
    const signal = new AbortController().signal
    await engine.pull(signal)
    const work = await createWorkspace('Work')
    const page = await createPage({ workspaceId: work })
    const personal = await createPage({ title: 'Unrelated edit' })
    const at = server.stamp()
    for (const name of ['work', 'Work (2)']) {
      const id = newId()
      server.workspaces.set(id, { id, user_id: userId, name, created_at: at, updated_at: at, deleted_at: null, purged_at: null, state_token: null })
    }
    await whenPersisted()
    await engine.push(signal)
    assert.equal(server.workspaces.get(work)!.name, 'Work (3)')
    assert.equal((await db.workspaces.get(work))!.name, 'Work (3)')
    assert.equal(server.pages.get(page)!.workspace_id, work)
    assert.ok(server.docs.get(page))
    assert.ok(server.docs.get(personal), 'unrelated notes also upload in the same cycle')
    assert.equal(await countPending(db), 0)

    // A conflicting rename of a previously synced space uses the same recovery.
    await updateWorkspace(work, { name: 'Business' })
    const remoteId = newId()
    const stamp = server.stamp()
    server.workspaces.set(remoteId, { id: remoteId, user_id: userId, name: 'Business', created_at: stamp, updated_at: stamp, deleted_at: null, purged_at: null, state_token: null })
    await engine.push(signal)
    assert.equal(server.workspaces.get(work)!.name, 'Business (2)')
    assert.equal(await countPending(db), 0)
  })

  it('inherits membership for children and isolates root ordering and dragging', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const personal = await createPage()
    const work = await createWorkspace('Work')
    const root = await createPage({ workspaceId: work })
    const child = await createPage({ parentId: root })
    assert.equal((await db.pages.get(child))?.workspaceId, work)
    assert.equal((await db.pages.get(root))?.sortKey, (await db.pages.get(personal))?.sortKey)
    assert.deepEqual((await liveChildren(db, '', work)).map((page) => page.id), [root])
    await assert.rejects(createPage({ parentId: root, workspaceId: userId }), /parent space/)
    await movePage(child, personal, 0)
    assert.equal((await db.pages.get(child))?.parentId, root)
    await dropRelative(root, personal, 'before')
    assert.equal((await db.pages.get(root))?.workspaceId, userId)
    assert.equal((await db.pages.get(child))?.workspaceId, userId)
  })

  it('persists workspace ordering and appends new workspaces after the reordered list', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const work = await createWorkspace('Work')
    const personal = await createWorkspace('Personal')
    await reorderWorkspace(work, userId, 'before')
    assert.deepEqual((await db.workspaces.toArray()).sort(workspaceOrder).map((row) => row.id), [work, userId, personal])
    const extra = await createWorkspace('Extra')
    await reorderWorkspace(work, personal, 'after')
    assert.deepEqual((await db.workspaces.toArray()).sort(workspaceOrder).map((row) => row.id), [userId, personal, work, extra])
    assert.ok((await db.workspaces.get(work))!.dirtyFields.includes('sortKey'))
  })

  it('transfers a nested note and its full subtree while preserving Trash, favourites and documents', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const originalParent = await createPage()
    const root = await createPage({ parentId: originalParent, title: 'Project' })
    const child = await createPage({ parentId: root })
    const trashed = await createPage({ parentId: child })
    await trashPage(trashed)
    await toggleFavorite(root)
    const work = await createWorkspace('Work')
    const destinationParent = await createPage({ workspaceId: work })
    await whenPersisted()
    const document = await db.docStates.get(root)
    await movePageToWorkspace(root, work, destinationParent)
    for (const id of [root, child, trashed]) assert.equal((await db.pages.get(id))!.workspaceId, work)
    assert.equal((await db.pages.get(root))!.parentId, destinationParent)
    assert.equal((await db.pages.get(child))!.parentId, root)
    assert.ok((await db.pages.get(trashed))!.deletedAt > 0)
    assert.equal((await db.pages.get(root))!.isFavorite, 1)
    assert.deepEqual(await db.docStates.get(root), document)
    assert.equal((await db.pages.get(originalParent))!.workspaceId, userId)
    await movePageToWorkspace(root, work, child)
    assert.equal((await db.pages.get(root))!.parentId, destinationParent, 'a move cannot make a parent cycle')
  })

  it('syncs ordering, unsynced transfers and children the moving device has not downloaded', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const server = new FakeServer()
    const engine = new SyncEngine(server.client(userId), userId) as unknown as {
      pull: (signal: AbortSignal) => Promise<unknown>; push: (signal: AbortSignal) => Promise<void>
    }
    const signal = new AbortController().signal
    await engine.pull(signal)
    const work = await createWorkspace('Work')
    const root = await createPage({ title: 'Project' })
    const child = await createPage({ parentId: root })
    await reorderWorkspace(work, userId, 'before')
    await movePageToWorkspace(root, work)
    await whenPersisted()
    await engine.push(signal)
    assert.equal(server.pages.get(root)!.workspace_id, work)
    assert.equal(server.pages.get(child)!.workspace_id, work)
    assert.equal(await db.workspaceOperations.count(), 0)
    assert.ok(server.docs.get(root))
    const content = server.docs.get(root)!.ydoc
    const unseen = newId()
    server.pages.set(unseen, { ...server.pages.get(child)!, id: unseen, parent_id: root, title: 'Unseen child', updated_at: server.stamp() })
    await movePageToWorkspace(root, userId)
    await engine.push(signal)
    assert.equal(server.pages.get(unseen)!.workspace_id, userId)
    assert.equal((await db.pages.get(unseen))!.workspaceId, userId)
    assert.equal(server.docs.get(root)!.ydoc, content)
    await db.workspaces.update(work, { sortKey: '' })
    await engine.pull(signal)
    assert.deepEqual((await db.workspaces.toArray()).sort(workspaceOrder).map((row) => row.id), [work, userId])
  })

  it('deletes recoverably and restores only notes moved by that workspace deletion', async () => {
    const db = openDatabase(newId())
    const work = await createWorkspace('Work')
    const root = await createPage({ workspaceId: work })
    const child = await createPage({ parentId: root })
    const earlier = await createPage({ parentId: root })
    await toggleFavorite(root)
    await trashPage(earlier)
    const previousDeletion = (await db.pages.get(earlier))!.deletedAt
    await whenPersisted()
    await deleteWorkspace(work)
    assert.ok((await db.workspaces.get(work))!.deletedAt > 0)
    assert.equal((await db.pages.get(child))!.workspaceDeletionId, (await db.workspaces.get(work))!.stateToken)
    assert.equal((await db.pages.get(earlier))!.workspaceDeletionId, '')
    assert.ok(await db.docStates.get(root), 'documents survive workspace deletion')
    await assert.rejects(createPage({ workspaceId: work }), /no longer available/)
    await restoreWorkspace(work)
    assert.equal((await db.pages.get(root))!.deletedAt, 0)
    assert.equal((await db.pages.get(root))!.isFavorite, 1)
    assert.equal((await db.pages.get(child))!.parentId, root)
    assert.equal((await db.pages.get(earlier))!.deletedAt, previousDeletion)
  })

  it('reactivates a deleted workspace with only individually restored notes', async () => {
    const db = openDatabase(newId())
    const work = await createWorkspace('Work')
    const parent = await createPage({ workspaceId: work })
    const child = await createPage({ parentId: parent })
    const nested = await createPage({ parentId: child })
    const earlier = await createPage({ parentId: child })
    const realNow = Date.now
    const sameMillisecond = realNow()
    try {
      Date.now = () => sameMillisecond
      await trashPage(earlier)
      await deleteWorkspace(work)
    } finally { Date.now = realNow }
    await restorePage(child)
    assert.equal((await db.workspaces.get(work))!.deletedAt, 0)
    assert.equal((await db.pages.get(child))!.parentId, '')
    assert.ok((await db.pages.get(nested))!.deletedAt > 0)
    assert.deepEqual((await db.pages.where('workspaceId').equals(work).filter((page) => !page.deletedAt).primaryKeys()), [child])
    assert.ok((await db.pages.get(parent))!.deletedAt > 0)
    assert.ok((await db.pages.get(earlier))!.deletedAt > 0, 'earlier Trash stays trashed even when timestamps match')
    await restorePage(parent)
    assert.ok((await db.pages.get(nested))!.deletedAt > 0, 'later restores also leave other notes in Trash')
    await restorePage(nested)
    assert.equal((await db.pages.get(nested))!.deletedAt, 0)
    assert.equal((await db.pages.get(nested))!.parentId, child)
    assert.ok((await db.pages.get(earlier))!.deletedAt > 0)
  })

  it('syncs individual workspace recovery without restoring unseen descendants', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const server = new FakeServer()
    const engine = new SyncEngine(server.client(userId), userId) as unknown as {
      pull: (signal: AbortSignal) => Promise<unknown>; push: (signal: AbortSignal) => Promise<void>
    }
    const signal = new AbortController().signal
    await engine.pull(signal)
    const work = await createWorkspace('Work')
    const parent = await createPage({ workspaceId: work })
    const child = await createPage({ parentId: parent })
    const nested = await createPage({ parentId: child })
    await whenPersisted()
    await engine.push(signal)
    const unseen = newId()
    server.pages.set(unseen, { ...server.pages.get(nested)!, id: unseen, updated_at: server.stamp() })
    await deleteWorkspace(work)
    await engine.push(signal)
    await restorePage(child)
    await engine.push(signal)
    assert.equal(server.workspaces.get(work)!.deleted_at, null)
    assert.equal(server.pages.get(child)!.deleted_at, null)
    assert.equal(server.pages.get(child)!.parent_id, null)
    for (const id of [parent, nested, unseen]) {
      assert.ok(server.pages.get(id)!.deleted_at)
      assert.ok((await db.pages.get(id))!.deletedAt)
    }
    await restorePage(nested)
    await engine.push(signal)
    assert.equal(server.pages.get(nested)!.deleted_at, null)
    assert.equal(server.pages.get(nested)!.parent_id, child)
    assert.ok(server.pages.get(unseen)!.deleted_at)
    assert.equal(await db.workspaceOperations.count(), 0)
  })

  it('scopes Empty trash and includes deleted workspaces when visible', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const personalPage = await createPage()
    const work = await createWorkspace('Work')
    const workPage = await createPage({ workspaceId: work })
    const archived = await createWorkspace('Archived')
    const archivedPage = await createPage({ workspaceId: archived })
    await trashPage(personalPage)
    await trashPage(workPage)
    await deleteWorkspace(archived)
    await emptyTrash([userId])
    assert.equal(await db.pages.get(personalPage), undefined)
    assert.ok(await db.pages.get(workPage))
    assert.ok(await db.pages.get(archivedPage))
    await emptyTrash()
    assert.equal(await db.pages.get(workPage), undefined)
    assert.ok(await db.pages.get(archivedPage))
    await emptyTrash([archived])
    assert.equal(await db.pages.get(archivedPage), undefined)
  })

  it('retains the last workspace and requires a separate permanent purge', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    await assert.rejects(deleteWorkspace(userId), /at least one space/)
    const work = await createWorkspace('Work')
    const page = await createPage({ workspaceId: work })
    await whenPersisted()
    await deleteWorkspace(work)
    await purgeWorkspace(work)
    assert.equal(await db.pages.get(page), undefined)
    assert.equal(await db.docStates.get(page), undefined)
    assert.ok((await db.workspaces.get(work))!.purgedAt > 0)
    assert.ok((await db.workspaceOperations.toArray()).some((operation) => operation.action === 'purge'))
  })

  it('converges across devices, preserving late offline notes in a deleted workspace', async () => {
    const userId = newId()
    const server = new FakeServer()
    const laptop = openDatabase(userId)
    await laptop.open()
    const phoneName = `${userId}:phone`
    const phone = openDatabase(phoneName)
    await phone.open()
    await phone.workspaces.clear()
    await phone.workspaces.add((await laptop.workspaces.get(userId))!)
    const laptopEngine = new SyncEngine(server.client(userId), userId)
    const phoneEngine = new SyncEngine(server.client(userId), userId)
    const sync = async (name: string, engine: InstanceType<typeof SyncEngine>) => {
      await whenPersisted()
      releaseAll()
      const db = openDatabase(name)
      const internals = engine as unknown as { db: unknown; isLeader: boolean; running: boolean; push: (signal: AbortSignal) => Promise<void>; pull: (signal: AbortSignal) => Promise<unknown> }
      internals.db = db
      internals.isLeader = true
      internals.running = true
      const signal = new AbortController().signal
      await internals.pull(signal)
      await internals.push(signal)
    }
    openDatabase(userId)
    const work = await createWorkspace('Work')
    const first = await createPage({ workspaceId: work })
    const earlier = await createPage({ workspaceId: work })
    await trashPage(earlier)
    await sync(userId, laptopEngine)
    await updateWorkspace(work, { name: 'Business' })
    await sync(userId, laptopEngine)
    await sync(phoneName, phoneEngine)
    assert.equal((await phone.workspaces.get(work))!.name, 'Business')
    const late = await createPage({ workspaceId: work })
    await whenPersisted()
    releaseAll()
    openDatabase(userId)
    await deleteWorkspace(work)
    await sync(userId, laptopEngine)
    // The offline phone also deletes Work before hearing about the laptop's
    // deletion. Its late note must join the accepted deletion for recovery.
    await whenPersisted()
    releaseAll()
    openDatabase(phoneName)
    await deleteWorkspace(work)
    await sync(phoneName, phoneEngine)
    assert.ok(server.pages.get(late)?.deleted_at)
    assert.ok(server.docs.get(late), 'late content reaches the server and remains recoverable')
    assert.ok((await phone.workspaces.get(work))!.deletedAt > 0)
    await sync(userId, laptopEngine)
    assert.ok((await laptop.pages.get(late))!.deletedAt > 0)
    await restoreWorkspace(work)
    await sync(userId, laptopEngine)
    await sync(phoneName, phoneEngine)
    assert.equal((await phone.pages.get(first))!.deletedAt, 0)
    assert.equal((await phone.pages.get(late))!.deletedAt, 0)
    assert.ok((await phone.pages.get(earlier))!.deletedAt > 0)
    await whenPersisted()
    releaseAll()
    openDatabase(userId)
    await deleteWorkspace(work)
    await sync(userId, laptopEngine)
    await purgeWorkspace(work)
    await sync(userId, laptopEngine)
    await sync(phoneName, phoneEngine)
    assert.equal(await phone.pages.get(first), undefined)
    assert.equal(await phone.docStates.get(late), undefined)
  })

  it('keeps an acknowledged operation until canonical refresh succeeds and retries safely', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const server = new FakeServer()
    const engine = new SyncEngine(server.client(userId), userId) as unknown as {
      pull: (signal: AbortSignal) => Promise<unknown>; push: (signal: AbortSignal) => Promise<void>
    }
    const signal = new AbortController().signal
    await engine.pull(signal)
    const work = await createWorkspace('Work')
    const page = await createPage({ workspaceId: work })
    await whenPersisted()
    await engine.push(signal)
    await deleteWorkspace(work)
    server.afterWorkspaceOperation = () => { server.failWorkspaceSelectOnce = true; server.afterWorkspaceOperation = null }
    await assert.rejects(engine.push(signal), /refresh interrupted/)
    const operations = await db.workspaceOperations.toArray()
    assert.equal(operations.length, 1)
    assert.equal(operations[0].acknowledged, true)
    await engine.push(signal)
    assert.equal(await db.workspaceOperations.count(), 0)
    assert.equal(server.workspaceReceipts.size, 1, 'the retry reuses the original operation receipt')
    assert.ok((await db.pages.get(page))!.deletedAt > 0)
    assert.ok(server.docs.get(page))
  })

  it('rolls back a rejected deletion when another device has deleted the other workspace', async () => {
    const userId = newId()
    const db = openDatabase(userId)
    const server = new FakeServer()
    const engine = new SyncEngine(server.client(userId), userId) as unknown as {
      pull: (signal: AbortSignal) => Promise<unknown>; push: (signal: AbortSignal) => Promise<void>
    }
    const signal = new AbortController().signal
    await engine.pull(signal)
    const work = await createWorkspace('Work')
    const page = await createPage({ workspaceId: work })
    await whenPersisted()
    await engine.push(signal)
    await deleteWorkspace(work)
    // The device has not pulled this remote deletion yet. Work is now the
    // last active workspace on the server, so its pending delete is rejected.
    server.workspaces.get(userId)!.deleted_at = server.stamp()
    server.workspaces.get(userId)!.state_token = newId()
    await engine.push(signal)
    assert.equal((await db.workspaces.get(work))!.deletedAt, 0)
    assert.equal((await db.pages.get(page))!.deletedAt, 0)
    assert.equal(await db.workspaceOperations.count(), 0)
  })
})
