import type { Editor } from '@tiptap/core'
import { createPage } from '@/lib/db/pages'
import { newId } from '@/lib/util/id'
import { pageHref } from '@/lib/util/links'

/** Turns the selected text into a link to a brand new subpage of `parentId`,
 *  titled with that text, and opens it once it has been written.
 *
 *  The id is chosen here so the link can go on straight away, while the
 *  selection is still the one that was clicked on; waiting for the page to be
 *  written first would leave a gap for typing, or an edit from another device,
 *  to move the text out from under it. */
export function linkToNewSubpage(
  editor: Editor,
  parentId: string,
  open: (pageId: string) => void,
) {
  const { from, to } = editor.state.selection
  if (from === to) return
  const title = editor.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim()
  // Only blank space selected would make an untitled page linked from nothing
  // anyone can see.
  if (!title) return
  const id = newId()
  const link = { href: pageHref(id) }
  // Inline code keeps every other mark out. A page made anyway would be
  // linked from nowhere.
  if (!editor.can().setLink(link)) return
  editor.chain().focus().setLink(link).run()
  void createPage({ id, parentId, title }).then(open)
}
