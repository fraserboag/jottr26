import * as Y from 'yjs'
import { activeDatabase } from './dexie'
import { createPage } from './pages'
import { DOC_FIELD, openDoc } from './ydoc'
import { readMeta, writeMeta } from './dexie'

const WELCOME_KEY = 'welcomed'

function el(name: string, text?: string, attrs?: Record<string, string>) {
  const node = new Y.XmlElement(name)
  if (attrs) for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  if (text) node.insert(0, [new Y.XmlText(text)])
  return node
}

const listItem = (text: string) => {
  const item = new Y.XmlElement('listItem')
  item.insert(0, [el('paragraph', text)])
  return item
}

const bulletList = (items: string[]) => {
  const list = new Y.XmlElement('bulletList')
  list.insert(0, items.map(listItem))
  return list
}

/** Written on the device that first signs in, then synced like any other page.
 *  The flag lives in local meta, so a second device does not write a second
 *  copy — it just pulls this one down. */
export async function ensureWelcomePage(): Promise<string | null> {
  const db = activeDatabase()
  if (!db) return null

  if (await readMeta(db, WELCOME_KEY, false)) return null
  await writeMeta(db, WELCOME_KEY, true)

  const count = await db.pages.count()
  if (count > 0) return null

  const id = await createPage({ title: 'Welcome to Jottr' })
  const handle = await openDoc(id)
  const fragment = handle.doc.getXmlFragment(DOC_FIELD)

  handle.doc.transact(() => {
    // Replace the empty paragraph that every new page starts with.
    if (fragment.length > 1) fragment.delete(1, fragment.length - 1)
    fragment.insert(fragment.length, [
      el('paragraph', 'This page is yours — edit it, or throw it away.'),
      el('heading', 'Writing', { level: '2' }),
      el('paragraph', "Press / on an empty line to insert a heading, a list, a quote or a code block. Select any text to format it."),
      bulletList([
        'Markdown shortcuts work: # for a heading, - for a bullet, > for a quote.',
        'Cmd/Ctrl + K opens search. It looks inside your pages, not just their titles.',
        'Drag a page in the sidebar to reorder it, or drop it on another to nest it.',
      ]),
      el('heading', 'Syncing', { level: '2' }),
      el(
        'paragraph',
        'Everything you type is written to this device first, so the editor never waits for the network. The indicator at the bottom of the sidebar tells you where your changes are.',
      ),
      el(
        'blockquote',
        'Edit the same page on two devices while offline and both sets of changes survive — they are merged, not overwritten.',
      ),
    ])
  })

  return id
}
