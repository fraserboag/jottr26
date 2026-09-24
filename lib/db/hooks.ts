'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { activeDatabase } from './dexie'
import { bySortKey } from './pages'
import type { PageRow } from './schema'

/** Live queries against IndexedDB. Dexie keeps these in sync across tabs, so a
 *  page created in one window appears in the other without a reload. */

export function useAllPages(userId: string | null): PageRow[] | undefined {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db || !userId) return []
    const rows = await db.pages.where('deletedAt').equals(0).toArray()
    return rows.sort(bySortKey)
  }, [userId])
}

export function useTrashedPages(userId: string | null): PageRow[] | undefined {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db || !userId) return []
    const rows = await db.pages.where('deletedAt').above(0).toArray()
    return rows.sort((a, b) => b.deletedAt - a.deletedAt)
  }, [userId])
}

export function usePage(pageId: string | null, userId: string | null): PageRow | undefined | null {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db || !pageId || !userId) return null
    return (await db.pages.get(pageId)) ?? null
  }, [pageId, userId])
}

/** A page's live subpages, in sidebar order. Live so that a page added, moved
 *  or trashed anywhere — the sidebar, another tab, another device — shows up
 *  in a list of them without a reload. */
export function useChildPages(parentId: string): PageRow[] | undefined {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db || !parentId) return []
    const rows = await db.pages.where('parentId').equals(parentId).toArray()
    return rows.filter((page) => !page.deletedAt).sort(bySortKey)
  }, [parentId])
}

/** Whether a page's document is on this device yet.
 *
 *  A page created here owns its own initial content. A page that arrived from
 *  the server does not, and letting the editor fill in an empty document would
 *  give the page two titles once the real one merged in — so it waits. */
export function useDocReady(pageId: string): boolean | undefined {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db) return undefined
    const [page, state] = await Promise.all([db.pages.get(pageId), db.docStates.get(pageId)])
    if (!page) return undefined
    return page.origin === 'local' || (state?.version ?? 0) > 0
  }, [pageId])
}

export interface TreeNode {
  page: PageRow
  children: TreeNode[]
}

/** Builds the sidebar tree. A page whose parent is missing — deleted, or not
 *  pulled down yet — is shown at the root rather than disappearing. */
export function buildTree(pages: PageRow[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const page of pages) nodes.set(page.id, { page, children: [] })

  const roots: TreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.page.parentId ? nodes.get(node.page.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => bySortKey(a.page, b.page))
    for (const node of list) sort(node.children)
  }
  sort(roots)
  return roots
}
