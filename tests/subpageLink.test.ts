import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
// For IndexedDB alone. The rest of the fake browser would put the editor on
// its DOM path, which a headless one cannot take.
import './harness'
import { openDatabase, activeDatabase, closeDatabase } from '@/lib/db/dexie'
import { linkToNewSubpage } from '@/components/editor/subpageLink'
import { pageHref } from '@/lib/util/links'
import { headlessEditor } from './editor'

/** A page whose one line reads 'Plan ' then 'Budget', the second part in the
 *  given marks. */
function editorWith(marks: Array<{ type: string }>) {
  return headlessEditor(
    {
      type: 'doc',
      content: [
        { type: 'title', content: [{ type: 'text', text: 'Home' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plan ' },
            { type: 'text', text: 'Budget', marks },
          ],
        },
      ],
    },
    1,
  )
}

/** Selects 'Budget'. */
function selectWord(editor: Editor) {
  editor.commands.command(({ tr }) => {
    let from = 0
    tr.doc.descendants((node, pos) => {
      const at = node.text?.indexOf('Budget') ?? -1
      if (at >= 0) from = pos + at
    })
    tr.setSelection(TextSelection.create(tr.doc, from, from + 'Budget'.length))
    return true
  })
}

function linkHref(editor: Editor): string | null {
  let href: string | null = null
  editor.state.doc.descendants((node) => {
    const link = node.marks.find((mark) => mark.type.name === 'link')
    if (link) href = link.attrs.href as string
  })
  return href
}

describe('link to a new subpage', () => {
  it('makes no page when the link cannot go on', async () => {
    openDatabase('subpage-link')
    const db = activeDatabase()!

    // Inline code keeps every other mark out, so the link is refused.
    const code = editorWith([{ type: 'code' }])
    selectWord(code)
    let openedFromCode = false
    linkToNewSubpage(code, 'home', () => {
      openedFromCode = true
    })
    assert.equal(linkHref(code), null)

    const plain = editorWith([])
    selectWord(plain)
    const opened = await new Promise<string>((resolve) => linkToNewSubpage(plain, 'home', resolve))
    assert.equal(linkHref(plain), pageHref(opened))

    assert.equal(openedFromCode, false)
    assert.deepEqual(
      (await db.pages.toArray()).map((page) => page.title),
      ['Budget'],
      'only the linked selection should have made a page',
    )
  })

  it('takes the link back off when the page cannot be written', async () => {
    closeDatabase()
    const plain = editorWith([])
    selectWord(plain)
    let opened = false
    await linkToNewSubpage(plain, 'home', () => {
      opened = true
    })
    assert.equal(opened, false)
    assert.equal(linkHref(plain), null)
  })
})
