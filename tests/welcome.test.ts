import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { Callout } from '@/components/editor/extensions/callout'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { writeWelcome } from '@/lib/db/welcome'
import { DOC_FIELD, seedDocument } from '@/lib/db/ydoc'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false }),
  Callout,
])

describe('the welcome page', () => {
  it('reads back as a valid page, with its callouts and bold headings intact', () => {
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
    const basics = body.find((node) => node.textContent === 'The Basics')!
    assert.ok(basics.firstChild!.marks.some((mark) => mark.type.name === 'bold'))
  })
})
