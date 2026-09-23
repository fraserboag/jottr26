import { activeDatabase } from './dexie'
import { createPage } from './pages'
import { readMeta, writeMeta } from './dexie'

const WELCOME_KEY = 'welcomed'

/** A blank page, written on the device that first signs in, then synced like
 *  any other page. The flag lives in local meta, so a second device does not
 *  write a second copy — it just pulls this one down. */
export async function ensureFirstPage(): Promise<string | null> {
  const db = activeDatabase()
  if (!db) return null

  if (await readMeta(db, WELCOME_KEY, false)) return null
  await writeMeta(db, WELCOME_KEY, true)

  const count = await db.pages.count()
  if (count > 0) return null

  return createPage()
}
