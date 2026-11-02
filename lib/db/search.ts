import { lastTouched, type EditedTimes } from './editedAt'
import type { NoteWorkspaceRow, PageRow } from './schema'

export interface Hit {
  page: PageRow
  snippet: string | null
}

export type WorkspaceHit =
  | ({ kind: 'page' } & Hit)
  | { kind: 'space'; space: Pick<NoteWorkspaceRow, 'id' | 'name'> }

function nameScore(name: string, query: string) {
  const value = name.toLowerCase()
  if (value === query) return 4
  if (value.startsWith(query)) return 3
  if (value.includes(query)) return 2
  return 0
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
 *  keeps working on a train. Titles rank above body matches. Typing in a page
 *  counts as touching it, which `edited` holds and the row does not. */
export function searchPages(
  pages: PageRow[],
  query: string,
  texts: SearchTexts = new Map(),
  edited: EditedTimes = new Map(),
): Hit[] {
  const q = query.trim().toLowerCase()
  const touched = (page: PageRow) => lastTouched(page, edited.get(page.id))
  if (!q) {
    return pages
      .slice()
      .sort((a, b) => touched(b) - touched(a))
      .slice(0, 12)
      .map((page) => ({ page, snippet: null }))
  }

  const scored: Array<{ hit: Hit; score: number }> = []
  for (const page of pages) {
    let score = nameScore(page.title || 'Untitled', q)
    if (!score && lowerBody(texts, page.id).includes(q)) score = 1
    if (!score) continue

    let snippet: string | null = null
    if (score === 1) {
      const at = lowerBody(texts, page.id).indexOf(q)
      const start = Math.max(0, at - 32)
      snippet = `${start > 0 ? '…' : ''}${(texts.get(page.id) ?? '').slice(start, at + q.length + 56).trim()}…`
    }
    scored.push({ hit: { page, snippet }, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || touched(b.hit.page) - touched(a.hit.page))
    .slice(0, 30)
    .map((entry) => entry.hit)
}

/** One ranking for both kinds of navigation result. Exact names win over
 *  prefixes, partial names, and body text before applying the shared limit. */
export function searchWorkspace(
  pages: PageRow[],
  spaces: readonly Pick<NoteWorkspaceRow, 'id' | 'name'>[],
  query: string,
  texts: SearchTexts = new Map(),
  edited: EditedTimes = new Map(),
  limit = 3,
): WorkspaceHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const matches: { hit: WorkspaceHit; score: number }[] = []
  for (const space of spaces) {
    const score = nameScore(space.name, q)
    if (score) matches.push({ hit: { kind: 'space', space }, score })
  }
  for (const hit of searchPages(pages, q, texts, edited)) {
    matches.push({
      hit: { kind: 'page', ...hit },
      score: hit.snippet === null ? nameScore(hit.page.title || 'Untitled', q) : 1,
    })
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit).map(({ hit }) => hit)
}
