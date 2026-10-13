'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeDatabase, readMeta, writeMeta } from '@/lib/db/dexie'
import { workspaceOrder } from '@/lib/db/workspaces'
import type { PageRow, NoteWorkspaceRow } from '@/lib/db/schema'
import { syncPageWorkspace, useOpenWorkspaceId, useOpenPageId } from '@/lib/util/route'
import { useWorkspace } from './WorkspaceProvider'

interface NoteWorkspacesValue {
  workspaces: NoteWorkspaceRow[]
  active: NoteWorkspaceRow[]
  selectedId: string
  inline: boolean
  select: (id: string) => Promise<void>
  setInline: (inline: boolean) => Promise<void>
  notice: string
  dismissNotice: () => Promise<void>
  ready: boolean
}

export const NoteWorkspacesContext = createContext<NoteWorkspacesValue | null>(null)

export function useNoteWorkspaces() {
  const value = useContext(NoteWorkspacesContext)
  if (!value) throw new Error('No space selection context')
  return value
}

/** One account-wide page list serves navigation; individual views choose a
 *  workspace scope. Preferences live locally in that account's database. */
export function useNoteWorkspaceState(pages: PageRow[]) {
  const { userId } = useWorkspace()
  const workspaceId = useOpenWorkspaceId()
  const [pageId, open] = useOpenPageId()
  const workspaces = useLiveQuery(async () => {
    const db = activeDatabase()
    return db && userId ? (await db.workspaces.toArray()).filter((row) => !row.purgedAt).sort(workspaceOrder) : []
  }, [userId])
  const preferences = useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db || !userId) return { inline: false, selected: '', notice: '' }
    const [inline, selected, notice] = await Promise.all([
      readMeta(db, 'workspaces:inline', false), readMeta(db, 'workspaces:selected', ''), readMeta(db, 'workspaces:notice', ''),
    ])
    return { inline, selected, notice }
  }, [userId])
  const active = useMemo(() => workspaces?.filter((row) => !row.deletedAt) ?? [], [workspaces])
  const owningId = pages.find((page) => page.id === pageId)?.workspaceId
  const selectedId = [owningId, workspaceId, preferences?.selected].find((id) => active.some((row) => row.id === id)) ?? active[0]?.id ?? ''

  useLayoutEffect(() => {
    if (pageId && owningId === selectedId) syncPageWorkspace(pageId, selectedId)
  }, [pageId, owningId, selectedId])

  useEffect(() => {
    const db = activeDatabase()
    if (!db || !selectedId) return
    void db.transaction('rw', db.meta, async () => {
      if (await readMeta(db, 'workspaces:selected', '') !== selectedId) await writeMeta(db, 'workspaces:selected', selectedId)
      if (pageId && owningId === selectedId) await writeMeta(db, `workspaces:lastPage:${selectedId}`, pageId)
    })
  }, [selectedId, pageId, owningId])

  const select = useCallback(async (id: string) => {
    const db = activeDatabase()
    if (!db || !active.some((row) => row.id === id)) return
    const last = await readMeta<string>(db, `workspaces:lastPage:${id}`, '')
    const destination = pages.find((page) => page.id === last && page.workspaceId === id)
    await writeMeta(db, 'workspaces:selected', id)
    open(destination?.id ?? null, { workspaceId: id })
  }, [active, pages, open])
  const setInline = useCallback(async (inline: boolean) => {
    const db = activeDatabase()
    if (db) await writeMeta(db, 'workspaces:inline', inline)
  }, [])
  const dismissNotice = useCallback(async () => {
    const db = activeDatabase()
    if (db) await writeMeta(db, 'workspaces:notice', '')
  }, [])
  return {
    workspaces: workspaces ?? [], active, selectedId, inline: preferences?.inline ?? false,
    select, setInline, notice: preferences?.notice ?? '', dismissNotice,
    ready: workspaces !== undefined && preferences !== undefined,
  }
}
