import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { createTable } from '@tiptap/extension-table'
import { EditorState } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { cellAt, page, pageSchema as schema, paragraph } from './editor'

const { DOC_FIELD, readPlainText } = await import('@/lib/db/ydoc')

/** A page with a 2×2 table, 'findme' typed into the first body cell. */
function tableWithText() {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Notes')),
    schema.node('paragraph'),
    createTable(schema, 2, 2, true),
  ])
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.insertText('findme', cellAt(state, 1, 0) + 2)).doc
}

/** Blocks whose text has to survive the trip into the Yjs document, rather
 *  than being skipped as a node it doesn't know. */
const blocks: Array<[string, () => Node]> = [
  ['a callout', () => page(schema.nodes.callout.create(null, paragraph('findme'))).doc],
  [
    'the box of a folded accordion',
    () =>
      page(
        schema.node('accordion', { open: false }, [
          schema.node('accordionTitle', null, [schema.text('Details')]),
          schema.node('accordionBody', null, [paragraph('findme')]),
        ]),
      ).doc,
  ],
  ['a table cell', tableWithText],
]

describe('the plain text that sync and search read', () => {
  for (const [where, build] of blocks) {
    it(`carries text in ${where} into it`, () => {
      const ydoc = new Y.Doc()
      prosemirrorToYXmlFragment(build(), ydoc.getXmlFragment(DOC_FIELD))
      // Search and page previews read this.
      assert.match(readPlainText(ydoc), /findme/)
    })
  }
})
