import type { PageRow } from './schema'

export interface Hit {
  page: PageRow
  snippet: string | null
}

/** The search text is up to 8,000 characters a page. The page list is the
 *  same array of rows for every keystroke typed into the search box, so each
 *  page's text is lowercased once rather than once per keystroke. */
const lowered = new WeakMap<PageRow, string>()

function lowerBody(page: PageRow) {
  let body = lowered.get(page)
  if (body === undefined) {
    body = page.searchText.toLowerCase()
    lowered.set(page, body)
  }
  return body
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

    let score = -1
    if (title.startsWith(q)) score = 3
    else if (title.includes(q)) score = 2
    else if (lowerBody(page).includes(q)) score = 1
    if (score < 0) continue

    let snippet: string | null = null
    if (score === 1) {
      const at = lowerBody(page).indexOf(q)
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
