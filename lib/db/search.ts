import type { PageRow } from './schema'

export interface Hit {
  page: PageRow
  snippet: string | null
}

/** Page ids to their search text, as searchText.ts reads them. */
export type SearchTexts = ReadonlyMap<string, string>

/** The search text is up to 8,000 characters a page. The texts are the same
 *  map for every keystroke typed into the search box, so each page's text is
 *  lowercased once rather than once per keystroke. */
const lowered = new WeakMap<SearchTexts, Map<string, string>>()

function lowerBody(texts: SearchTexts, pageId: string) {
  let bodies = lowered.get(texts)
  if (!bodies) lowered.set(texts, (bodies = new Map()))
  let body = bodies.get(pageId)
  if (body === undefined) {
    body = (texts.get(pageId) ?? '').toLowerCase()
    bodies.set(pageId, body)
  }
  return body
}

/** Search runs over the local copy, so it answers as fast as you can type and
 *  keeps working on a train. Titles rank above body matches. */
export function searchPages(pages: PageRow[], query: string, texts: SearchTexts = new Map()): Hit[] {
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
    else if (lowerBody(texts, page.id).includes(q)) score = 1
    if (score < 0) continue

    let snippet: string | null = null
    if (score === 1) {
      const at = lowerBody(texts, page.id).indexOf(q)
      const start = Math.max(0, at - 32)
      snippet = `${start > 0 ? '…' : ''}${(texts.get(page.id) ?? '').slice(start, at + q.length + 56).trim()}…`
    }
    scored.push({ hit: { page, snippet }, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.hit.page.updatedAt - a.hit.page.updatedAt)
    .slice(0, 30)
    .map((entry) => entry.hit)
}
