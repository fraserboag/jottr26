import * as Y from 'yjs'
import { activeDatabase } from './dexie'
import { createPage, refreshDerived } from './pages'
import { readMeta, writeMeta } from './dexie'
import { DOC_FIELD, openDoc } from './ydoc'

const WELCOME_KEY = 'welcomed'

const WELCOME_TITLE = 'Welcome to Jottr'

/** One body block: a paragraph, a blank line, a divider, a numbered list or a
 *  callout. Text takes **bold** and `code`; section headings are bold
 *  paragraphs, since the editor has no heading block. */
type Block = string | null | 'divider' | { ordered: string[] } | { callout: string[] }

/** A section break: a divider with a blank line either side. */
const BREAK: Block[] = [null, 'divider', null]

const WELCOME_BODY: Block[] = [
  {
    callout: [
      "If you're used to text editors and other notes apps, Jottr is probably pretty self explanatory and you won't get much out of this document. But if you're looking for specific details, read on...",
    ],
  },
  ...BREAK,
  '**The Basics**',
  'Create pages in the sidebar, pages can be nested as deeply as you like and can be dragged and dropped to arrange. Click the star in the top-right corner of a page to favourite it - favourites appear in their own section in the sidebar.',
  ...BREAK,
  '**Formatting**',
  'Pages begin as plain text but can be customised in a few key ways:',
  null,
  {
    ordered: [
      "**The text formatting toolbar** - highlight any text anywhere and this will pop up, allowing you to create links and format text in all the usual ways. If you're on mobile the toolbar is always visible when your keyboard is open.",
      '**The block menu** - type `/` (forward slash) at any time to pop open the block menu and select from a range of blocks, from simple to more advanced. You can start typing after the slash to search the menu and get to your block more quickly.',
      "**Markdown support** - most of the usual markdown shortcuts apply, if you're used to that.",
    ],
  },
  ...BREAK,
  '**Shortcuts**',
  "All of the usual text formatting shortcuts you're used to are supported here, as well as undo and redo. Select All works a bit differently to some apps - `Ctrl/Cmd + A` selects all of the current line, tapping `A` twice selects the whole document.",
  ...BREAK,
  '**Advanced Blocks**',
  "Most blocks simply format text in all of the usual ways you'd expect, but there are a couple of blocks worth going into a little more detail on.",
  '**Tables** - a table block with its own toolbar to control the number of rows and columns. This also has a couple of extra settings to enable/disable a heading row and to enable/disable finance mode. In finance mode any column containing only numbers will be formatted as monetary values and automatically totaled at the bottom.',
  "**Subpages** - a fairly unique block to Jottr which allows you to easily create organisational index pages to categorise your notes. The best way to see how this works is to try it out by creating a page with multiple subpages. Add a `/subpages` block to the top level page to show the list of subpages. This gets extra powerful if you have multiple levels, as you can modify the `/subpages` block to show 2 levels of depth, which then categorises your sub-subpages under subpage headings. I realise that sounds insane, but give it a go and you'll understand immediately.",
  ...BREAK,
  '**Install the App**',
  'Jottr follows the PWA standard which means you can install it as an app via your web browser. Most, if not all, devices and operating systems support this - desktop and mobile. Once installed this way, Jottr looks and functions exactly like any other native app.',
  "A PWA is always installed via a menu in your web browser while accessing the web app you want to install. If you don't know how to do it on your device just do a web search for `How to install PWA {your operating system} {your browser}`, for example `How to install PWA iOS Chrome`.",
  ...BREAK,
  '**Offline Support**',
  'Jottr was built from the ground up for offline support. Behind the scenes Jottr is always saving your pages locally on your device first and then syncing to the server when possible (so that it can keep your notes in sync across multiple devices).',
  "Naturally if you modify the same note on 2 different devices with no internet connection, Jottr will have issues merging those. It'll try its best to reconcile, but this can inevitably result in some data loss.",
  null,
  {
    callout: [
      "If you like, you can delete this document once you're done with it, or file it away for future reference. 🙂",
    ],
  },
]

/** A paragraph whose **bold** and `code` runs carry those marks. */
function paragraph(text: string) {
  const node = new Y.XmlElement('paragraph')
  if (!text) return node
  const content = new Y.XmlText()
  let at = 0
  for (const run of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean)) {
    const bold = run.startsWith('**')
    const code = run.startsWith('`')
    const plain = bold ? run.slice(2, -2) : code ? run.slice(1, -1) : run
    content.insert(at, plain, bold ? { bold: {} } : code ? { code: {} } : {})
    at += plain.length
  }
  node.insert(0, [content])
  return node
}

function wrap(name: string, children: Y.XmlElement[]) {
  const node = new Y.XmlElement(name)
  node.insert(0, children)
  return node
}

function block(item: Block): Y.XmlElement {
  if (item === null) return paragraph('')
  if (item === 'divider') return new Y.XmlElement('horizontalRule')
  if (typeof item === 'string') return paragraph(item)
  if ('ordered' in item) {
    return wrap('orderedList', item.ordered.map((text) => wrap('listItem', [paragraph(text)])))
  }
  return wrap('callout', item.callout.map(paragraph))
}

/** Replaces a freshly seeded page's empty body with the welcome guide. Built
 *  by hand, like the seed, so the storage layer carries no editor dependency. */
export function writeWelcome(doc: Y.Doc) {
  const fragment = doc.getXmlFragment(DOC_FIELD)
  doc.transact(() => {
    fragment.delete(1, fragment.length - 1)
    fragment.insert(1, WELCOME_BODY.map(block))
  })
}

/** The welcome guide, written on the device that first signs in, then synced
 *  like any other page. The flag lives in local meta, so a second device does
 *  not write a second copy — it just pulls this one down. */
export async function ensureFirstPage(): Promise<string | null> {
  const db = activeDatabase()
  if (!db) return null

  if (await readMeta(db, WELCOME_KEY, false)) return null
  await writeMeta(db, WELCOME_KEY, true)

  const count = await db.pages.count()
  if (count > 0) return null

  const id = await createPage({ title: WELCOME_TITLE })
  writeWelcome((await openDoc(id)).doc)
  await refreshDerived(id)
  return id
}
