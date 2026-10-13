import { activeDatabase, type JottrDB } from './dexie'
import { forgetPages } from './pages'
import { notifyLocalEdit } from './ydoc'
import { newId } from '@/lib/util/id'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { NoteWorkspaceRow, WorkspaceOperationRow } from './schema'

function database() {
  const db = activeDatabase()
  if (!db) throw new Error('No open account')
  return db
}

export const workspaceOrder = (a: NoteWorkspaceRow, b: NoteWorkspaceRow) => {
  const left = a.sortKey ?? ''
  const right = b.sortKey ?? ''
  return (left < right ? -1 : left > right ? 1 : 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

export async function reorderWorkspace(id: string, targetId: string, side: 'before' | 'after') {
  if (id === targetId) return
  const db = database()
  await db.transaction('rw', db.workspaces, async () => {
    const ordered = (await db.workspaces.filter((row) => !row.deletedAt && !row.purgedAt).toArray()).sort(workspaceOrder)
    const moving = ordered.find((row) => row.id === id)
    if (!moving || !ordered.some((row) => row.id === targetId)) return
    const next = ordered.filter((row) => row.id !== id)
    next.splice(next.findIndex((row) => row.id === targetId) + (side === 'after' ? 1 : 0), 0, moving)
    if (next.every((row, index) => row.id === ordered[index].id)) return
    const keys = generateNKeysBetween(null, null, next.length)
    for (const [index, row] of next.entries()) {
      if (row.sortKey === keys[index]) continue
      await db.workspaces.update(row.id, {
        sortKey: keys[index], updatedAt: Math.max(Date.now(), row.updatedAt + 1), dirty: 1,
        dirtyFields: [...new Set([...row.dirtyFields, 'sortKey' as const])],
      })
    }
  })
  notifyLocalEdit('structure')
}

/** Hold page metadata until ordered move operations have reached the server.
 *  Include children created after the original drag too. */
export async function pendingMovePageIds(db: JottrDB) {
  const operations = await db.workspaceOperations.filter((row) => row.action === 'movePage' && !row.acknowledged).toArray()
  const ids = new Set(operations.flatMap((row) => row.pageIds ?? [row.pageId]))
  if (ids.size === 0) return ids
  const pages = await db.pages.toArray()
  for (let previous = -1; previous !== ids.size;) {
    previous = ids.size
    for (const page of pages) if (ids.has(page.parentId)) ids.add(page.id)
  }
  return ids
}

async function validName(db: JottrDB, value: string, except = '') {
  const name = value.trim()
  if (!name) throw new Error('Enter a space name.')
  if (name.length > 80) throw new Error('Use a name of 80 characters or fewer.')
  const duplicate = await db.workspaces.toCollection().filter((workspace) =>
    !workspace.deletedAt && !workspace.purgedAt && workspace.id !== except &&
    workspace.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  ).first()
  if (duplicate) throw new Error('A space with that name already exists.')
  return name
}

export async function createWorkspace(value: string) {
  const db = database()
  const id = newId()
  await db.transaction('rw', db.workspaces, async () => {
    const name = await validName(db, value)
    const now = Date.now()
    const ordered = (await db.workspaces.filter((row) => !row.deletedAt && !row.purgedAt).toArray()).sort(workspaceOrder)
    const last = ordered.at(-1)?.sortKey
    await db.workspaces.add({
      id, name, sortKey: last ? generateKeyBetween(last, null) : '', createdAt: now, updatedAt: now, serverUpdatedAt: 0,
      deletedAt: 0, purgedAt: 0, stateToken: '', dirty: 1, dirtyFields: ['name', 'sortKey'],
    })
  })
  notifyLocalEdit('structure')
  return id
}

export async function updateWorkspace(id: string, patch: { name?: string }, allowDeleted = false) {
  const db = database()
  await db.transaction('rw', db.workspaces, async () => {
    const workspace = await db.workspaces.get(id)
    if (!workspace || (workspace.deletedAt && !allowDeleted) || workspace.purgedAt) throw new Error('Space is no longer available.')
    const fields = Object.keys(patch) as Array<'name'>
    if (patch.name !== undefined) patch = { ...patch, name: await validName(db, patch.name, id) }
    await db.workspaces.update(id, {
      ...patch, updatedAt: Math.max(Date.now(), workspace.updatedAt + 1), dirty: 1,
      dirtyFields: [...new Set([...workspace.dirtyFields, ...fields])],
    })
  })
  notifyLocalEdit('structure')
}

/** Workspace lifecycle writes and their offline queue entry are committed
 *  together. Page documents stay untouched until an explicit permanent purge. */
async function lifecycle(id: string, action: WorkspaceOperationRow['action'], pageId = '') {
  const db = database()
  await db.transaction('rw', [db.workspaces, db.workspaceOperations, db.pages, db.docStates, db.docUpdates, db.meta], async () => {
    const workspace = await db.workspaces.get(id)
    if (!workspace || workspace.purgedAt) throw new Error('Space is no longer available.')
    if (action === 'delete') {
      if (workspace.deletedAt) return
      const active = await db.workspaces.filter((row) => !row.deletedAt && !row.purgedAt).count()
      if (active <= 1) throw new Error('Keep at least one space. Create another before deleting this one.')
    } else if (!workspace.deletedAt) {
      return
    }
    if (action === 'restore' || action === 'restorePage') await validName(db, workspace.name, id)
    const operation: WorkspaceOperationRow = {
      id: newId(), workspaceId: id, action, expectedState: workspace.stateToken,
      pageId, queuedAt: Date.now(),
    }
    await db.workspaceOperations.add(operation)
    await db.workspaces.update(id, {
      deletedAt: action === 'delete' ? operation.queuedAt : 0,
      purgedAt: action === 'purge' ? operation.queuedAt : 0,
      stateToken: operation.id,
    })
    if (action === 'delete') {
      await db.pages.where('workspaceId').equals(id).modify((page) => {
        if (page.deletedAt) return
        page.deletedAt = operation.queuedAt
        page.workspaceDeletionId = operation.id
      })
    } else if (action === 'restore') {
      await db.pages.where('workspaceId').equals(id).modify((page) => {
        if (page.workspaceDeletionId !== workspace.stateToken) return
        page.deletedAt = 0
        page.workspaceDeletionId = ''
      })
    } else if (action === 'purge') {
      const ids = await db.pages.where('workspaceId').equals(id).primaryKeys() as string[]
      await forgetPages(db, ids)
    }
  })
  notifyLocalEdit('structure')
}

export const deleteWorkspace = (id: string) => lifecycle(id, 'delete')
export const restoreWorkspace = (id: string) => lifecycle(id, 'restore')
export const restoreWorkspaceForPage = (id: string, pageId: string) => lifecycle(id, 'restorePage', pageId)
export const purgeWorkspace = (id: string) => lifecycle(id, 'purge')

/** Apply the effective state after a pull, including pending local operations.
 *  This makes notes received from an offline device recoverable in Trash. */
export async function enforceWorkspaceState(db: JottrDB) {
  const workspaces = await db.workspaces.toArray()
  for (const workspace of workspaces) {
    if (workspace.purgedAt) {
      await forgetPages(db, await db.pages.where('workspaceId').equals(workspace.id).primaryKeys() as string[])
    } else if (workspace.deletedAt) {
      await db.pages.where('workspaceId').equals(workspace.id).filter((page) => !page.deletedAt).modify((page) => {
        page.deletedAt = workspace.deletedAt
        page.workspaceDeletionId = workspace.stateToken
      })
    }
  }
}
