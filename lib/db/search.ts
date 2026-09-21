import type { PageRow } from './schema'

export interface Hit {
  page: PageRow
  snippet: string | null
}

/** Search runs over the local copy, so it answers as fast as you can type and
 *  keeps working on a train. Titles rank above body matches. */
export function searchPages(pages: PageRow[], query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return pages
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12)
      .map((page) => ({ page, snippet: null }))
  }

  const scored: Array<{ hit: Hit; score: number }> = []
  for (const page of pages) {
    const title = (page.title || 'Untitled').toLowerCase()
    const body = page.searchText.toLowerCase()

    let score = -1
    if (title.startsWith(q)) score = 3
    else if (title.includes(q)) score = 2
    else if (body.includes(q)) score = 1
    if (score < 0) continue

    let snippet: string | null = null
    if (score === 1) {
      const at = body.indexOf(q)
      const start = Math.max(0, at - 32)
      snippet = `${start > 0 ? '…' : ''}${page.searchText.slice(start, at + q.length + 56).trim()}…`
    }
    scored.push({ hit: { page, snippet }, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.hit.page.updatedAt - a.hit.page.updatedAt)
    .slice(0, 30)
    .map((entry) => entry.hit)
}
