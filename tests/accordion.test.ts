import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import {
  AccordionKit,
  backspaceAccordion,
  enterAccordionBody,
  leaveAccordion,
  makeAccordion,
  setAccordionOpen,
  unwrapAccordion,
} from '@/components/editor/extensions/accordion'
import { Callout } from '@/components/editor/extensions/callout'
import { FinanceTable } from '@/components/editor/extensions/finance'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { filterSlashItems } from '@/components/editor/extensions/slash'

/** The editor's real extension list, minus the ones that need a browser. */
const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  ...AccordionKit,
  TableKit.configure({ table: false }),
  FinanceTable.configure({ renderWrapper: true }),
])

function paragraph(text?: string) {
  return schema.node('paragraph', null, text ? [schema.text(text)] : [])
}

function accordion(title: string, body: Node[] = [paragraph()], open = true) {
  return schema.node('accordion', { open }, [
    schema.node('accordionTitle', null, title ? [schema.text(title)] : []),
    schema.node('accordionBody', null, body),
  ])
}

/** A page holding the given body blocks, with the caret at the end. */
function page(...body: Node[]) {
  const doc = schema.node('doc', null, [schema.node('title', null, schema.text('Notes')), ...body])
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(doc.content.size), -1)))
}

function caretAt(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** The position of the first textblock of the given type, plus an offset. */
function inside(state: EditorState, type: string, offset = 0) {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos + 1 + offset
    return found < 0
  })
  assert.notEqual(found, -1, `no ${type} in the document`)
  return found
}

function run(state: EditorState, command: Command) {
  let next = state
  let transaction: Transaction | null = null
  const applied = command(state, (tr) => {
    transaction = tr
    next = state.apply(tr)
  })
  return { state: next, applied, tr: transaction as Transaction | null }
}

function outline(state: EditorState) {
  return state.doc.children.map((node) => node.type.name)
}

describe('accordion block', () => {
  it('fits the page schema, and survives the trip through Yjs', async () => {
    const state = page(accordion('Details', [paragraph('hidden text')], false))
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'accordion'])

    const { DOC_FIELD, readPlainText } = await import('@/lib/db/ydoc')
    const ydoc = new Y.Doc()
    const fragment = ydoc.getXmlFragment(DOC_FIELD)
    prosemirrorToYXmlFragment(state.doc, fragment)
    const back = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    assert.equal(back.child(1).attrs.open, false, 'folded stays folded on another device')
    // Search reads this: text in a folded box is still found.
    assert.match(readPlainText(ydoc), /hidden text/)
  })

  it('turns a paragraph into an accordion, its text becoming the heading', () => {
    const start = page(paragraph('Travel plans'))
    const at = caretAt(start, inside(start, 'paragraph', 3))
    const { state, applied } = run(at, makeAccordion())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'accordion'])
    const node = state.doc.child(1)
    assert.equal(node.child(0).textContent, 'Travel plans')
    assert.equal(node.attrs.open, true)
    // The caret stays where it was in the words.
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
    assert.equal(state.selection.$from.parentOffset, 3)
  })

  it('refuses where an accordion cannot go, like the first line of a list item', () => {
    const start = page(schema.node('bulletList', null, [schema.node('listItem', null, [paragraph('one')])]))
    assert.equal(run(start, makeAccordion()).applied, false)
  })

  it('goes into the box on Enter in the heading, opening it if folded', () => {
    const start = page(accordion('Details', [paragraph('already here')], false))
    const at = caretAt(start, inside(start, 'accordionTitle', 7))
    const { state, applied, tr } = run(at, enterAccordionBody())
    assert.equal(applied, true)
    assert.equal(state.doc.child(1).attrs.open, true)
    assert.equal(state.selection.$from.parent.type.name, 'paragraph')
    assert.equal(state.selection.$from.node(-1).type.name, 'accordionBody')
    // A fresh line above what was there, not the head of the existing one.
    assert.equal(state.selection.$from.parent.content.size, 0)
    assert.equal(state.doc.child(1).child(1).childCount, 2)
    assert.notEqual(tr?.getMeta('addToHistory'), false, 'typing a new line is an edit to undo')
  })

  it('uses the empty line a new box already has', () => {
    const start = page(accordion('Details'))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state } = run(at, enterAccordionBody())
    assert.equal(state.doc.child(1).child(1).childCount, 1)
  })

  it('leaves the box on Enter from an empty last line, taking the line along', () => {
    const start = page(accordion('Details', [paragraph('text'), paragraph()]))
    const { state, applied } = run(start, leaveAccordion())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'accordion', 'paragraph'])
    assert.equal(state.doc.child(1).child(1).childCount, 1)
    assert.equal(state.selection.$from.depth, 1)
  })

  it('leaves the only line of the box behind, since the box needs one', () => {
    const start = page(accordion('Details'))
    const { state, applied } = run(start, leaveAccordion())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'accordion', 'paragraph'])
    assert.equal(state.selection.$from.depth, 1)
  })

  it('leaves Enter alone on a line with words in it, or one that is not last', () => {
    assert.equal(run(page(accordion('Details', [paragraph('text')])), leaveAccordion()).applied, false)
    const start = page(accordion('Details', [paragraph(), paragraph('text')]))
    const first = caretAt(start, inside(start, 'accordionBody', 1))
    assert.equal(run(first, leaveAccordion()).applied, false)
  })

  it('goes back to plain blocks on Backspace at the start of the heading', () => {
    const start = page(accordion('Details', [paragraph('one'), paragraph('two')]))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state, applied } = run(at, backspaceAccordion())
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph', 'paragraph', 'paragraph'])
    assert.deepEqual(state.doc.children.slice(1).map((node) => node.textContent), ['Details', 'one', 'two'])
    assert.equal(state.selection.$from.parentOffset, 0)
  })

  it('leaves no blank line behind from a box that was never written in', () => {
    const start = page(accordion(''))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state } = run(at, unwrapAccordion())
    assert.deepEqual(outline(state), ['title', 'paragraph'])
  })

  it('leaves Backspace alone part-way through the heading', () => {
    const start = page(accordion('Details'))
    const at = caretAt(start, inside(start, 'accordionTitle', 2))
    assert.equal(run(at, backspaceAccordion()).applied, false)
  })

  it('folds without an undo step, lifting a caret out of the box', () => {
    const start = page(accordion('Details', [paragraph('text')]))
    const { state, applied, tr } = run(start, setAccordionOpen(start.doc.child(0).nodeSize, false))
    assert.equal(applied, true)
    assert.equal(state.doc.child(1).attrs.open, false)
    assert.equal(tr?.getMeta('addToHistory'), false)
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
    assert.equal(state.selection.$from.parentOffset, 'Details'.length)
  })

  it('is offered by the slash menu, under the words people reach for', () => {
    for (const query of ['accordion', 'toggle', 'collapse', 'fold']) {
      assert.equal(
        filterSlashItems(query).some((item) => item.id === 'accordion'),
        true,
        `'${query}' should find the accordion`,
      )
    }
  })
})
