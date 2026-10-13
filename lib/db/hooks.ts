'use client'

import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { activeDatabase } from './dexie'
import { bySortKey, liveChildren } from './pages'
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

/** A page's live subpages, in sidebar order. Live so that a page added, moved
 *  or trashed anywhere — the sidebar, another tab, another device — shows up
 *  in a list of them without a reload. */
export function useChildPages(parentId: string): PageRow[] | undefined {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db || !parentId) return []
    return liveChildren(db, parentId)
  }, [parentId])
}

/** A page's live subpages two levels down: each child, in sidebar order, with
 *  its own children under it. Live for the same reasons as the list above. */
export function useGrandchildPages(parentId: string, enabled: boolean): TreeNode[] | undefined {
  return useLiveQuery(async () => {
    const db = activeDatabase()
    // Not loaded rather than empty while switched off, so switching it on
    // doesn't flash an empty list before the pages arrive.
    if (!enabled) return undefined
    if (!db || !parentId) return []
    const children = await liveChildren(db, parentId)
    const under = new Map<string, TreeNode[]>(children.map((page) => [page.id, []]))
    for (const page of await liveChildren(db, [...under.keys()])) {
      under.get(page.parentId)?.push({ page, children: [] })
    }
    return children.map((page) => ({ page, children: under.get(page.id)! }))
  }, [parentId, enabled])
}

/** Whether a page's document is on this device yet.
 *
 *  A page created here owns its own initial content. A page that arrived from
 *  the server does not, and letting the editor fill in an empty document would
 *  give the page two titles once the real one merged in — so it waits. */
export function useDocReady(pageId: string): boolean | undefined {
  // Once there, a document never leaves, so its state row — rewritten on every
  // keystroke — stops being read, and typing stops waking this query.
  const arrived = useRef<string | null>(null)
  return useLiveQuery(async () => {
    const db = activeDatabase()
    if (!db) return undefined
    const page = await db.pages.get(pageId)
    if (!page) return undefined
    if (page.origin === 'local' || arrived.current === pageId) return true
    const state = await db.docStates.get(pageId)
    if ((state?.version ?? 0) === 0) return false
    arrived.current = pageId
    return true
  }, [pageId])
}

/** Drawn nowhere in the sidebar. Search text and edit time were written on
 *  every pause in typing by older builds, and can still arrive on rows they
 *  wrote. The rest is sync's bookkeeping, which moves on every push and on the
 *  pull after it without anything the sidebar shows changing. */
const UNDRAWN = new Set<string>([
  'searchText',
  'editedAt',
  'updatedAt',
  'serverUpdatedAt',
  'dirty',
  'dirtyFields',
  'createdAt',
  'origin',
])

function sameForSidebar(a: PageRow, b: PageRow) {
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (UNDRAWN.has(key)) continue
    const x = left[key]
    const y = right[key]
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((item, i) => item !== y[i])) return false
    } else if (!Object.is(x, y)) {
      return false
    }
  }
  return true
}

/** The page list with last time's rows kept wherever only undrawn fields
 *  moved on, and last time's list itself when that is all that did.
 *
 *  Every push, and the pull that follows it, rewrites a row's sync
 *  bookkeeping, and the live query hands back every row new each time. Passed
 *  straight on, the whole sidebar tree would be rebuilt and redrawn for each.
 *  The rows kept here can carry stale undrawn fields, so they are for drawing
 *  only; anything that acts on a page reads it again by id. */
export function reuseRows(previous: readonly PageRow[], next: PageRow[]): PageRow[] {
  const before = new Map(previous.map((page) => [page.id, page]))
  let changed = previous.length !== next.length
  const rows = next.map((page, index) => {
    const old = before.get(page.id)
    const kept = old && sameForSidebar(old, page) ? old : page
    if (kept !== previous[index]) changed = true
    return kept
  })
  return changed ? rows : (previous as PageRow[])
}

/** `pages` through reuseRows, render to render. */
export function useDrawnRows(pages: PageRow[]): PageRow[] {
  const [seen, setSeen] = useState(pages)
  const [drawn, setDrawn] = useState(pages)
  if (seen !== pages) {
    setSeen(pages)
    setDrawn(reuseRows(drawn, pages))
  }
  return drawn
}

export interface TreeNode {
  page: PageRow
  children: TreeNode[]
}

/** Builds the sidebar tree from pages already in sidebar order, as
 *  useAllPages returns them; each level keeps that order. A page whose parent
 *  is missing — deleted, or not pulled down yet — is shown at the root rather
 *  than disappearing. So is the first of a ring of pages that are each inside
 *  another, which a merge of two offline moves can leave behind. */
export function buildTree(pages: PageRow[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const page of pages) nodes.set(page.id, { page, children: [] })

  // Which pages sit at the root. A page in a ring never reaches one by
  // walking up, so the walk that comes back round to its start cuts it loose.
  const atRoot = new Set<string>()
  for (const page of pages) {
    if (!nodes.has(page.parentId) || nodes.get(page.parentId)!.page.workspaceId !== page.workspaceId) {
      atRoot.add(page.id)
      continue
    }
    const seen = new Set([page.id])
    let id = page.parentId
    while (nodes.has(id) && !atRoot.has(id) && !seen.has(id)) {
      seen.add(id)
      id = nodes.get(id)!.page.parentId
    }
    if (id === page.id) atRoot.add(page.id)
  }

  const roots: TreeNode[] = []
  for (const node of nodes.values()) {
    if (atRoot.has(node.page.id)) roots.push(node)
    else nodes.get(node.page.parentId)!.children.push(node)
  }
  return roots
}
