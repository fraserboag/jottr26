'use client'

import { useMemo, useState } from 'react'
import type { PageRow } from '@/lib/db/schema'

/** Deep enough for any real tree, and a guard against a parent loop that a
 *  bad merge could leave behind. */
const MAX_DEPTH = 24

/** A page's parent, grandparent and so on up to the top level. */
export function ancestors(byId: ReadonlyMap<string, PageRow>, page: PageRow | undefined | null): PageRow[] {
  const out: PageRow[] = []
  let current = page?.parentId ? byId.get(page.parentId) : undefined
  while (current && out.length < MAX_DEPTH) {
    out.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return out
}

/** The open page's trail, top level first and the page itself last. */
export function usePageTrail(byId: ReadonlyMap<string, PageRow>, page: PageRow | null): PageRow[] {
  return useMemo(() => (page ? [...ancestors(byId, page).reverse(), page] : []), [byId, page])
}

/** Which way the page slides in: from the left when it is an ancestor of the
 *  one being left, since that is going back up the tree. Worked out while
 *  rendering, from the last page seen, so the new page mounts already facing
 *  the right way. */
export function useEntryFromAbove(byId: ReadonlyMap<string, PageRow>, openId: string | null): boolean {
  const [entry, setEntry] = useState<{ id: string | null; up: boolean }>({ id: openId, up: false })
  if (entry.id !== openId) {
    const left = entry.id ? byId.get(entry.id) : undefined
    const up = openId !== null && ancestors(byId, left).some((page) => page.id === openId)
    setEntry({ id: openId, up })
    return up
  }
  return entry.up
}
