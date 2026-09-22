import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { lift, wrapIn } from '@tiptap/pm/commands'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { Callout, leaveCallout, newLineInCallout } from '@/components/editor/extensions/callout'
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

/** The same document with the caret parked at an exact position. */
function caretAt(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** The two keys the callout binds, as the extension binds them. */
const enter = leaveCallout('callout')
const shiftEnter = newLineInCallout('callout')

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

  it('leaves the box on Enter, and opens a line under it', () => {
    // The way out. A callout is allowed to be the last block on a page, so
    // without this there is no way back down past one sitting at the foot of
    // the page.
    const start = page(callout.create(null, paragraph('Watch out')))
    const { state, applied } = run(start, enter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'callout', 'paragraph'])
    assert.equal(state.doc.child(1).textContent, 'Watch out', 'the text stays in the box')
    // The caret is on the new line, directly in the page rather than the box.
    assert.equal(state.selection.$from.parent.type.name, 'paragraph')
    assert.equal(state.selection.$from.depth, 1)
    assert.equal(state.selection.$from.parent.content.size, 0)
  })

  it('leaves the line it was on alone, wherever the caret was', () => {
    // Enter part-way through a line does not split it: the box keeps the words
    // it had, and the new line opens after the box.
    const start = page(callout.create(null, paragraph('Watch out')))
    const middle = caretAt(start, start.selection.from - 4)
    const { state, applied } = run(middle, enter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'callout', 'paragraph'])
    assert.equal(state.doc.child(1).textContent, 'Watch out')
  })

  it('takes an empty last line with it rather than leaving a blank row', () => {
    const start = page(callout.create(null, [paragraph('Watch out'), paragraph()]))
    const { state, applied } = run(start, enter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'callout', 'paragraph'])
    assert.equal((state.doc.child(1) as Node).childCount, 1, 'the blank line is not left behind')
  })

  it('drops a callout that was never written in', () => {
    // Enter on the empty line of an empty box is the way out of one opened by
    // accident: the box goes with the line.
    const start = page(callout.create(null, paragraph()))
    const { state, applied } = run(start, enter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph'])
  })

  it('leaves Enter alone inside a list in a callout, where it means next item', () => {
    const start = page(
      callout.create(null, [
        schema.node('bulletList', null, [schema.node('listItem', null, [paragraph('one')])]),
      ]),
    )
    assert.equal(run(start, enter).applied, false)
  })

  it('leaves Enter alone outside a callout', () => {
    assert.equal(run(page(paragraph('Watch out')), enter).applied, false)
  })

  it('opens a line inside the box on Shift-Enter', () => {
    const start = page(callout.create(null, paragraph('Watch out')))
    const { state, applied } = run(start, shiftEnter)
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'callout'], 'the new line stays in the box')
    assert.equal((state.doc.lastChild as Node).childCount, 2)
    assert.equal(state.selection.$from.depth, 2)
  })

  it('leaves Shift-Enter alone outside a callout, where it is a line break', () => {
    assert.equal(run(page(paragraph('Watch out')), shiftEnter).applied, false)
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
