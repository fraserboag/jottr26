import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { AccordionKit } from '@/components/editor/extensions/accordion'
import { Callout } from '@/components/editor/extensions/callout'
import { Heading } from '@/components/editor/extensions/heading'
import { ListItem } from '@/components/editor/extensions/lists'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { writeWelcome } from '@/lib/db/welcome'
import { DOC_FIELD, seedDocument } from '@/lib/db/ydoc'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false, listItem: false }),
  Callout,
  ListItem,
  ...AccordionKit,
  Heading,
])

describe('the welcome page', () => {
  it('reads back as a valid page, with its callouts, dividers, titles, list and marks intact', () => {
    const doc = new Y.Doc()
    seedDocument(doc)
    writeWelcome(doc)
    const fragment = doc.getXmlFragment(DOC_FIELD)
    const blocks = fragment.length

    const page = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    page.check()
    // y-prosemirror drops whatever the schema rejects, so nothing may be lost.
    assert.equal(page.childCount, blocks)

    const body = Array.from({ length: page.childCount - 1 }, (_, i) => page.child(i + 1))
    assert.equal(body[0].type.name, 'callout')
    assert.equal(body.at(-1)!.type.name, 'callout')
    const titles = body.filter((node) => node.type.name === 'heading').map((node) => node.textContent)
    assert.deepEqual(titles, ['The Basics', 'Formatting', 'Shortcuts', 'Advanced Blocks', 'Install the App', 'Offline Support'])
    const basics = body.find((node) => node.textContent === 'The Basics')!
    // The block is the title's weight; bold on top would be a second one.
    assert.deepEqual(basics.firstChild!.marks, [])
    assert.equal(body[body.indexOf(basics) - 2].type.name, 'horizontalRule')

    const list = body.find((node) => node.type.name === 'orderedList')!
    assert.equal(list.childCount, 3)
    const toolbar = list.firstChild!.firstChild!.firstChild!
    assert.equal(toolbar.text, 'The text formatting toolbar')
    assert.ok(toolbar.marks.some((mark) => mark.type.name === 'bold'))

    const code: string[] = []
    page.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'code')) code.push(node.text!)
    })
    assert.ok(code.includes('Ctrl/Cmd + A'))
    assert.ok(code.includes('/subpages'))
  })
})
