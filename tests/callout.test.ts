import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { lift, liftEmptyBlock, wrapIn } from '@tiptap/pm/commands'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { Callout } from '@/components/editor/extensions/callout'
import { FinanceTable } from '@/components/editor/extensions/finance'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { filterSlashItems } from '@/components/editor/extensions/slash'

/** The editor's real extension list, minus the ones that need a browser. */
const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  TableKit.configure({ table: false }),
  FinanceTable.configure({ renderWrapper: true }),
])

const callout = schema.nodes.callout

/** A page holding the given body blocks, with the caret in the last text
 *  position — which is where someone typing has just arrived. */
function page(...body: Node[]) {
  const doc = schema.node('doc', null, [
    schema.node('title', null, schema.text('Notes')),
    ...body,
  ])
  const state = EditorState.create({ doc, schema })
  return state.apply(
    state.tr.setSelection(TextSelection.near(doc.resolve(doc.content.size), -1)),
  )
}

function paragraph(text?: string) {
  return schema.node('paragraph', null, text ? [schema.text(text)] : [])
}

/** Run a ProseMirror command the way the editor's chain does. */
function run(state: EditorState, command: Command) {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { state: next, applied }
}

/** The names of the document's top-level blocks, title included. */
function outline(state: EditorState) {
  return state.doc.children.map((node) => node.type.name)
}

describe('callout block', () => {
  it('fits the page schema, which requires a title followed by blocks', () => {
    const state = page(callout.create(null, paragraph('Watch out')))
    // Throws if the document violates the schema's content expression.
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'callout'])
  })

  it('wraps the paragraph the caret is in, and unwraps it again', () => {
    const start = page(paragraph('Watch out'))
    const wrapped = run(start, wrapIn(callout))
    assert.equal(wrapped.applied, true)
    assert.deepEqual(outline(wrapped.state), ['title', 'callout'])
    assert.equal(wrapped.state.doc.lastChild?.firstChild?.textContent, 'Watch out')

    // What toggleCallout does the second time round.
    const unwrapped = run(wrapped.state, lift)
    assert.equal(unwrapped.applied, true)
    assert.deepEqual(outline(unwrapped.state), ['title', 'paragraph'])
  })

  it('holds more than a paragraph: a quote and a list go in too', () => {
    const state = page(
      callout.create(null, [
        schema.node('blockquote', null, [paragraph('Watch out')]),
        schema.node('bulletList', null, [
          schema.node('listItem', null, [paragraph('one')]),
        ]),
      ]),
    )
    state.doc.check()
    assert.deepEqual(
      (state.doc.lastChild as Node).children.map((node) => node.type.name),
      ['blockquote', 'bulletList'],
    )
  })

  it('lets an empty line at the end escape the box', () => {
    // The way out. A callout is the last block a page allows, so without this
    // there would be no way to get back below one sitting at the bottom of the
    // page. Enter runs liftEmptyBlock; the first press leaves the callout, the
    // second lands the paragraph after it.
    let state = page(callout.create(null, [paragraph('Watch out'), paragraph()]))
    state = run(state, liftEmptyBlock).state
    state = run(state, liftEmptyBlock).state
    assert.deepEqual(outline(state), ['title', 'callout', 'paragraph'])
    assert.equal(state.doc.lastChild?.type.name, 'paragraph')
    assert.equal((state.doc.child(1) as Node).childCount, 1, 'the text stays in the box')
  })

  it('carries its text into the Yjs document that sync and search read', async () => {
    const { DOC_FIELD, readPlainText } = await import('@/lib/db/ydoc')
    const state = page(callout.create(null, paragraph('findme')))

    const ydoc = new Y.Doc()
    prosemirrorToYXmlFragment(state.doc, ydoc.getXmlFragment(DOC_FIELD))
    // Search and page previews read this, so text inside a callout has to
    // survive the trip into the CRDT rather than being skipped.
    assert.match(readPlainText(ydoc), /findme/)
  })

  it('is offered by the slash menu, under the words people reach for', () => {
    for (const query of ['callout', 'note', 'box', 'aside']) {
      assert.equal(
        filterSlashItems(query).some((item) => item.id === 'callout'),
        true,
        `'${query}' should find the callout`,
      )
    }
  })
})
