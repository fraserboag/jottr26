import { readMeta, writeMeta, type JottrDB } from './dexie'
import type { PageRow } from './schema'

/** Each page's flattened text for search, kept in `meta` rather than on its
 *  page row. The sidebar reads every row each time typing pauses, and 8,000
 *  characters a page it never draws made that read a copy of every note. Only
 *  the link picker reads these, once as it opens. Derived from the document
 *  and never synced. */
const PREFIX = 'search:'
const MOVED = 'searchTextMoved'

const keyOf = (pageId: string) => `${PREFIX}${pageId}`

export async function writeSearchText(db: JottrDB, pageId: string, text: string) {
  const key = keyOf(pageId)
  if ((await db.meta.get(key))?.value === text) return
  await db.meta.put({ key, value: text })
}

export async function readSearchTexts(db: JottrDB): Promise<Map<string, string>> {
  const rows = await db.meta.where('key').startsWith(PREFIX).toArray()
  return new Map(rows.map((row) => [row.key.slice(PREFIX.length), String(row.value)]))
}

export async function forgetSearchTexts(db: JottrDB, pageIds: string[]) {
  await db.meta.bulkDelete(pageIds.map(keyOf))
}

/** Once per database: copies the text off page rows written before it moved,
 *  then takes it off them, in one transaction so search never goes without
 *  it. A text already in `meta` is newer than the row's and is kept. */
export async function moveSearchTexts(db: JottrDB) {
  await db.transaction('rw', db.pages, db.meta, async () => {
    if (await readMeta(db, MOVED, false)) return
    const carrying = db.pages.filter((page) => (page as Partial<PageRow>).searchText !== undefined)
    const rows = await carrying.toArray()
    const moved = await db.meta.bulkGet(rows.map((page) => keyOf(page.id)))
    await db.meta.bulkPut(
      rows
        .filter((page, index) => !moved[index] && page.searchText)
        .map((page) => ({ key: keyOf(page.id), value: page.searchText })),
    )
    await carrying.modify((page) => {
      delete (page as Partial<PageRow>).searchText
    })
    await writeMeta(db, MOVED, true)
  })
}
