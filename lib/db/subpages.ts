import * as Y from 'yjs'
import { SUBPAGES, SUBPAGES_DEFAULT_TITLE, SUBPAGES_TITLE } from '@/components/editor/extensions/subpages'
import { DOC_FIELD } from './ydoc'

/** A subpage list used to hold nothing, its heading drawn by the block itself;
 *  now the heading is a line in it that can be written in. The editor deletes
 *  any node that doesn't fit its schema, from the document and so from every
 *  device, and a list with no heading doesn't. So the page is put right first:
 *  each list without a heading gets one saying what it always said, drawn as
 *  the Title it always was.
 *
 *  And a list with more than one keeps only its first. That is two devices
 *  each giving the same old list its heading while apart, then merging, and
 *  it would be deleted just the same.
 *
 *  Run where checkbox lists are converted, for the same reasons: when a page
 *  is put on screen, before the editor binds to it, as an ordinary local edit. */

const isTitle = (item: unknown) => item instanceof Y.XmlElement && item.nodeName === SUBPAGES_TITLE

function needsRepair(parent: Y.XmlFragment | Y.XmlElement): boolean {
  return parent.toArray().some((child) => {
    if (!(child instanceof Y.XmlElement)) return false
    if (child.nodeName === SUBPAGES) return child.length !== 1 || !isTitle(child.get(0))
    return needsRepair(child)
  })
}

function repairIn(parent: Y.XmlFragment | Y.XmlElement) {
  for (const child of parent.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue
    if (child.nodeName !== SUBPAGES) {
      repairIn(child)
      continue
    }
    // The first heading stays; everything else in the block goes.
    const first = child.toArray().findIndex(isTitle)
    for (let index = child.length - 1; index >= 0; index -= 1) {
      if (index !== first) child.delete(index, 1)
    }
    if (first === -1) {
      const title = new Y.XmlElement(SUBPAGES_TITLE)
      // It was drawn as a Title, so it stays one.
      title.setAttribute('title', true as unknown as string)
      title.insert(0, [new Y.XmlText(SUBPAGES_DEFAULT_TITLE)])
      child.insert(0, [title])
    }
  }
}

/** Give every subpage list on the page exactly one heading. Leaves a page that
 *  already has them untouched, not so much as an empty transaction. */
export function repairSubpageTitles(doc: Y.Doc) {
  const fragment = doc.getXmlFragment(DOC_FIELD)
  if (!needsRepair(fragment)) return
  doc.transact(() => repairIn(fragment))
}
