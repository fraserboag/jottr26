import type { JottrDB } from './dexie'
import type { PageRow } from './schema'

/** When this device last typed in each page, kept in `meta` rather than on its
 *  page row. It moves on every pause in typing, and on the row that woke the
 *  sidebar's query of every page each time, to read it all again for a value
 *  it never draws. Search pickers read these while they are in use.
 *  Local only, and never synced. */
const PREFIX = 'edited:'

export const editedKey = (pageId: string) => `${PREFIX}${pageId}`

/** Page ids to when they were last typed in. */
export type EditedTimes = ReadonlyMap<string, number>

export async function writeEditedAt(db: JottrDB, pageId: string, at: number) {
  const key = editedKey(pageId)
  if (Number((await db.meta.get(key))?.value ?? 0) >= at) return
  await db.meta.put({ key, value: at })
}

export async function readEditedTimes(db: JottrDB): Promise<Map<string, number>> {
  const rows = await db.meta.where('key').startsWith(PREFIX).toArray()
  return new Map(rows.map((row) => [row.key.slice(PREFIX.length), Number(row.value)]))
}

export async function forgetEditedTimes(db: JottrDB, pageIds: string[]) {
  await db.meta.bulkDelete(pageIds.map(editedKey))
}

/** The last change to a page: to the row, or to the document. A row written
 *  before the time moved here may still carry its own, and is read too. */
export function lastTouched(page: PageRow, edited: number | undefined) {
  return Math.max(page.updatedAt, page.editedAt ?? 0, edited ?? 0)
}
