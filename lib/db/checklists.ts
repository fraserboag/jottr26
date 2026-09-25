import * as Y from 'yjs'
import { DOC_FIELD } from './ydoc'

/** Checkbox lists were taken out of the editor. A document written before
 *  then can still hold one, and the editor drops any node its schema does not
 *  know, deleting it from the document and so from every device, text and
 *  all. So the page is rewritten first: each checkbox list becomes a bullet
 *  list with the same items, and whether an item was ticked is let go.
 *
 *  Run when a page is put on screen, before the editor binds to it, rather
 *  than whenever a document loads: the sync engine loads documents too, and
 *  one converted from a stale copy on disk, then merged with the same list
 *  already converted on another device, would come out with the list twice.
 *  Committed as an ordinary local edit, so it is saved and pushed once. */

const RENAMED: Record<string, string> = { taskList: 'bulletList', taskItem: 'listItem' }

/** A fresh copy of a checkbox list's subtree, with the list and its items
 *  renamed — a Yjs element's name is fixed, so renaming means rebuilding. */
function rebuild(element: Y.XmlElement): Y.XmlElement {
  const copy = new Y.XmlElement(RENAMED[element.nodeName] ?? element.nodeName)
  for (const [key, value] of Object.entries(element.getAttributes())) {
    if (key !== 'checked') copy.setAttribute(key, value as string)
  }
  // Elements and text are all the editor ever writes; Yjs's hooks never appear.
  copy.insert(
    0,
    element.toArray().map((child) => (child instanceof Y.XmlElement ? rebuild(child) : (child as Y.XmlText).clone())),
  )
  return copy
}

function convertIn(parent: Y.XmlFragment | Y.XmlElement) {
  parent.toArray().forEach((child, index) => {
    if (!(child instanceof Y.XmlElement)) return
    if (child.nodeName !== 'taskList') return convertIn(child)
    const copy = rebuild(child)
    parent.delete(index, 1)
    parent.insert(index, [copy])
  })
}

function hasChecklist(parent: Y.XmlFragment | Y.XmlElement): boolean {
  return parent
    .toArray()
    .some((child) => child instanceof Y.XmlElement && (child.nodeName === 'taskList' || hasChecklist(child)))
}

/** Turn the page's checkbox lists into bullet lists. Leaves a page without
 *  any untouched, not so much as an empty transaction. */
export function convertChecklists(doc: Y.Doc) {
  const fragment = doc.getXmlFragment(DOC_FIELD)
  if (!hasChecklist(fragment)) return
  doc.transact(() => convertIn(fragment))
}
