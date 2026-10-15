import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { installBrowserGlobals } from './harness'

installBrowserGlobals()

const { openDatabase, closeDatabase, writeMeta } = await import('@/lib/db/dexie')
const { createPage, trashPage, deleteForever, touch, movePageToWorkspace } = await import('@/lib/db/pages')
const { createWorkspace } = await import('@/lib/db/workspaces')
const { canRestoreWelcomePage, ensureFirstPage, restoreWelcomePage } = await import('@/lib/db/welcome')
const { openDoc, readPlainText, whenPersisted, releaseAll } = await import('@/lib/db/ydoc')
const { META_LAST_SYNCED } = await import('@/lib/db/schema')
const { newId } = await import('@/lib/util/id')

afterEach(async () => { await whenPersisted(); releaseAll(); closeDatabase() })

describe('restoring the welcome page', () => {
  it('stays hidden before onboarding and while the guide is live, renamed or moved', async () => {
    openDatabase(newId())
    assert.equal(await canRestoreWelcomePage(), false)
    const id = (await ensureFirstPage())!
    assert.equal(await canRestoreWelcomePage(), false)
    await touch(id, { title: 'My guide' })
    await movePageToWorkspace(id, await createWorkspace('Work'))
    assert.equal(await canRestoreWelcomePage(), false)
  })

  it('restores the same trashed page without replacing its document', async () => {
    const db = openDatabase(newId())
    const id = (await ensureFirstPage())!
    const doc = (await openDoc(id)).doc
    doc.getMap('custom').set('note', 'Keep my edits')
    await trashPage(id)
    assert.equal(await canRestoreWelcomePage(), true)
    assert.equal(await restoreWelcomePage(), id)
    assert.equal((await db.pages.get(id))?.deletedAt, 0)
    assert.equal((await openDoc(id)).doc.getMap('custom').get('note'), 'Keep my edits')
    assert.equal(await canRestoreWelcomePage(), false)
    assert.equal(await restoreWelcomePage(), id)
    assert.equal(await db.pages.count(), 1)
  })

  it('recreates the full guide in the selected space after permanent deletion', async () => {
    const db = openDatabase(newId())
    const original = (await ensureFirstPage())!
    await trashPage(original)
    await deleteForever(original)
    const workspaceId = await createWorkspace('Work')
    assert.equal(await canRestoreWelcomePage(), true)
    const id = await restoreWelcomePage(workspaceId)
    assert.notEqual(id, original)
    assert.equal((await db.pages.get(id))?.workspaceId, workspaceId)
    assert.equal((await db.pages.get(id))?.title, 'Welcome to Jottr')
    assert.match(readPlainText((await openDoc(id)).doc), /The Basics/)
    assert.match(readPlainText((await openDoc(id)).doc), /Offline Support/)
    assert.equal(await canRestoreWelcomePage(), false)
  })

  it('recognises an existing guide without local onboarding metadata', async () => {
    openDatabase(newId())
    const id = await createPage({ title: 'Welcome to Jottr' })
    assert.equal(await canRestoreWelcomePage(), false)
    await trashPage(id)
    assert.equal(await canRestoreWelcomePage(), true)
    assert.equal(await restoreWelcomePage(), id)
    assert.equal(await canRestoreWelcomePage(), false)
  })

  it('allows recovery on a synced second device after the guide was purged', async () => {
    const db = openDatabase(newId())
    await createPage({ title: 'Another note' })
    assert.equal(await canRestoreWelcomePage(), false)
    await writeMeta(db, META_LAST_SYNCED, Date.now())
    assert.equal(await canRestoreWelcomePage(), true)
    await restoreWelcomePage()
    assert.equal(await canRestoreWelcomePage(), false)
  })
})
