import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { EditorState, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { liftListItem, sinkListItem, splitListItem } from '@tiptap/pm/schema-list'
import type { Node } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import {
  backspaceAccordion,
  backspaceAfterFolded,
  backspaceIntoHeading,
  enterAccordionBody,
  leaveAccordion,
  makeAccordion,
  setAccordionOpen,
  unwrapAccordion,
} from '@/components/editor/extensions/accordion'
import { backspaceAfterList, backspaceNestedItem } from '@/components/editor/extensions/lists'
import { caretAt, headlessEditor, inside, outline, page, pageSchema as schema, paragraph, run } from './editor'

function accordion(title: string, body: Node[] = [paragraph()], open = true) {
  return schema.node('accordion', { open }, [
    schema.node('accordionTitle', null, title ? [schema.text(title)] : []),
    schema.node('accordionBody', null, body),
  ])
}

describe('accordion block', () => {
  it('fits the page schema, and survives the trip through Yjs', async () => {
    const state = page(accordion('Details', [paragraph('hidden text')], false))
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'accordion'])

    const { DOC_FIELD } = await import('@/lib/db/ydoc')
    const fragment = new Y.Doc().getXmlFragment(DOC_FIELD)
    prosemirrorToYXmlFragment(state.doc, fragment)
    const back = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    assert.equal(back.child(1).attrs.open, false, 'folded stays folded on another device')
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

  it('brings the heading in bold on the page', () => {
    const start = page(paragraph('Travel plans'))
    const { state } = run(start, makeAccordion())
    const heading = state.doc.child(1).child(0)
    heading.forEach((text) => assert.ok(schema.marks.bold.isInSet(text.marks), 'bold throughout'))

    // An empty one types in bold from the first letter.
    const blank = run(page(paragraph()), makeAccordion()).state
    assert.ok(blank.storedMarks && schema.marks.bold.isInSet(blank.storedMarks))
  })

  it('refuses where an accordion cannot go, like a line of code', () => {
    const start = page(schema.node('codeBlock', null, [schema.text('x = 1')]))
    assert.equal(run(start, makeAccordion()).applied, false)
  })

  it('steps over a folded box on Enter in its heading, onto a new line below', () => {
    const start = page(accordion('Details', [paragraph('already here')], false), paragraph('next'))
    const at = caretAt(start, inside(start, 'accordionTitle', 7))
    const { state, applied } = run(at, enterAccordionBody())
    assert.equal(applied, true)
    assert.equal(state.doc.child(1).attrs.open, false, 'the box stays folded')
    assert.equal(state.doc.child(1).child(1).childCount, 1, 'nothing typed into the box')
    assert.equal(state.doc.child(2).type.name, 'paragraph')
    assert.equal(state.doc.child(2).content.size, 0)
    assert.equal(state.doc.child(3).textContent, 'next')
    assert.equal(state.selection.$from.depth, 1, 'on the page, not in the box')
    assert.equal(state.selection.$from.index(0), 2)
  })

  it('goes into an open box on Enter in the heading', () => {
    const start = page(accordion('Details', [paragraph('already here')]))
    const at = caretAt(start, inside(start, 'accordionTitle', 7))
    const { state, applied, tr } = run(at, enterAccordionBody())
    assert.equal(applied, true)
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

  it('deletes an empty heading on Backspace, leaving the box on the page and the caret on the line above', () => {
    const start = page(paragraph('above'), accordion('', [paragraph('one'), paragraph('two')]))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state, applied } = run(at, backspaceAccordion())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'paragraph', 'paragraph', 'paragraph'])
    assert.deepEqual(state.doc.children.slice(1).map((node) => node.textContent), ['above', 'one', 'two'])
    assert.equal(state.selection.$from.parent.textContent, 'above')
    assert.equal(state.selection.$from.parentOffset, 'above'.length)
  })

  it('deletes an empty accordion outright, up to the end of the line above', () => {
    const start = page(paragraph('above'), accordion(''), paragraph('below'))
    const { state, applied } = run(caretAt(start, inside(start, 'accordionTitle')), backspaceAccordion())
    assert.equal(applied, true)
    assert.deepEqual(state.doc.children.slice(1).map((node) => node.textContent), ['above', 'below'])
    assert.equal(state.selection.$from.parentOffset, 'above'.length)
  })

  it('leaves an empty line where the accordion was the only block on the page', () => {
    const start = page(accordion(''))
    const { state, applied } = run(caretAt(start, inside(start, 'accordionTitle')), backspaceAccordion())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outline(state), ['title', 'paragraph'])
  })

  it('jumps up to the end of the line above on Backspace at the start of a heading with words in it', () => {
    const start = page(paragraph('above'), accordion('Details', [paragraph('one')]))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state, applied } = run(at, backspaceAccordion())
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'paragraph', 'accordion'])
    assert.equal(state.doc.child(2).child(0).textContent, 'Details')
    assert.equal(state.selection.$from.parent.textContent, 'above')
    assert.equal(state.selection.$from.parentOffset, 'above'.length)
  })

  it('jumps up to the end of the page title from a heading straight under it', () => {
    const start = page(accordion('Details'))
    const { state, applied } = run(caretAt(start, inside(start, 'accordionTitle')), backspaceAccordion())
    assert.equal(applied, true)
    assert.equal(state.selection.$from.parent.type.name, 'title')
    assert.equal(state.selection.$from.parentOffset, 'Notes'.length)
    assert.deepEqual(outline(state), ['title', 'accordion'])
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

  it('jumps up to the end of the heading on Backspace at the start of the box', () => {
    const start = page(accordion('Details', [paragraph('text'), paragraph('more')]))
    const at = caretAt(start, inside(start, 'accordionBody', 1))
    const { state, applied } = run(at, backspaceIntoHeading())
    assert.equal(applied, true)
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
    assert.equal(state.selection.$from.parentOffset, 'Details'.length)
    // Nothing is deleted or merged: the line stays in the box.
    assert.deepEqual(state.doc.child(1).child(1).children.map((node) => node.textContent), ['text', 'more'])
  })

  it('takes an empty first line of the box with it, unless it is the only one', () => {
    const start = page(accordion('Details', [paragraph(), paragraph('more')]))
    const { state } = run(caretAt(start, inside(start, 'accordionBody', 1)), backspaceIntoHeading())
    assert.deepEqual(state.doc.child(1).child(1).children.map((node) => node.textContent), ['more'])
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')

    const only = page(accordion('Details'))
    const left = run(caretAt(only, inside(only, 'accordionBody', 1)), backspaceIntoHeading())
    assert.equal(left.applied, true)
    left.state.doc.check()
    assert.equal(left.state.doc.child(1).child(1).childCount, 1)
  })

  it('leaves Backspace alone part-way through a line, or on a later line of the box', () => {
    const start = page(accordion('Details', [paragraph('text'), paragraph('more')]))
    const mid = caretAt(start, inside(start, 'accordionBody', 3))
    assert.equal(run(mid, backspaceIntoHeading()).applied, false)
    const second = caretAt(start, inside(start, 'accordionBody', 1 + 'text'.length + 2))
    assert.equal(second.selection.$from.parent.textContent, 'more')
    assert.equal(run(second, backspaceIntoHeading()).applied, false)
  })

  it('jumps to the end of a folded heading on Backspace from the line below, rather than into the box', () => {
    const start = page(accordion('Details', [paragraph('hidden')], false), paragraph('next'))
    const { state, applied } = run(caretAt(start, inside(start, 'paragraph', 0) + 'hidden'.length + 4), backspaceAfterFolded())
    assert.equal(applied, true)
    assert.equal(state.doc.child(1).child(1).textContent, 'hidden', 'nothing joined into the box')
    assert.equal(state.doc.child(2).textContent, 'next')
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
    assert.equal(state.selection.$from.parentOffset, 'Details'.length)
  })

  it('deletes an empty line below a folded accordion, up to its heading', () => {
    const start = page(accordion('Details', [paragraph('hidden')], false), paragraph(), paragraph('after'))
    const empty = inside(start, 'paragraph', 0) + 'hidden'.length + 4
    const { state, applied } = run(caretAt(start, empty), backspaceAfterFolded())
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'accordion', 'paragraph'])
    assert.equal(state.doc.child(2).textContent, 'after')
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
  })

  it('takes a divider straight above on Backspace at the start of a heading with words in it', () => {
    const start = page(schema.node('horizontalRule'), accordion('Details', [paragraph('text')]))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state, applied } = run(at, backspaceAccordion())
    assert.equal(applied, true)
    assert.deepEqual(outline(state), ['title', 'accordion'])
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
    assert.equal(state.selection.$from.parentOffset, 0)
  })

  it('leaves Backspace alone below an open box', () => {
    const start = page(accordion('Details', [paragraph('shown')]), paragraph('next'))
    const at = caretAt(start, inside(start, 'paragraph', 0) + 'shown'.length + 4)
    assert.equal(run(at, backspaceAfterFolded()).applied, false)
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

  it('carries a selection being extended with Shift past a folded box, rather than collapsing it', () => {
    const line = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const folded = {
      type: 'accordion',
      attrs: { open: false },
      content: [
        { type: 'accordionTitle', content: [{ type: 'text', text: 'Head' }] },
        { type: 'accordionBody', content: [line('hidden')] },
      ],
    }
    const title = { type: 'title', content: [{ type: 'text', text: 'N' }] }
    const instance = headlessEditor({ type: 'doc', content: [title, line('above'), folded, line('below')] }, 4)
    const { plugins } = instance.extensionManager
    const { doc } = instance.state
    // 'above' opens at 4, the hidden line holds 21, 'below' opens at 29 and
    // the heading ends at 16.
    const extend = (anchor: number, head: number) => {
      const state = EditorState.create({ doc, plugins, selection: TextSelection.create(doc, anchor) })
      const { selection } = state.apply(state.tr.setSelection(TextSelection.create(doc, anchor, head)))
      return [selection.anchor, selection.head]
    }
    assert.deepEqual(extend(4, 21), [4, 29], 'down from above goes on past the box')
    assert.deepEqual(extend(29, 21), [29, 16], 'up from below stops at the heading')
  })

  it('lands an arrow key on the heading, not on a divider hidden in a folded box', () => {
    const line = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const title = { type: 'title', content: [{ type: 'text', text: 'N' }] }
    const folded = (...body: object[]) => ({
      type: 'accordion',
      attrs: { open: false },
      content: [
        { type: 'accordionTitle', content: [{ type: 'text', text: 'Head' }] },
        { type: 'accordionBody', content: body },
      ],
    })
    // What prosemirror-view does for an arrow key beside a divider: selects it.
    const arrow = (content: object[], from: number, dir: 1 | -1) => {
      const instance = headlessEditor({ type: 'doc', content }, 1)
      const { doc } = instance.state
      let state = EditorState.create({ doc, plugins: instance.extensionManager.plugins })
      state = state.apply(state.tr.setSelection(TextSelection.create(doc, from)))
      const $at = state.selection.$from
      const target = Selection.findFrom(doc.resolve(dir < 0 ? $at.before() : $at.after()), dir)!
      assert.ok(target instanceof NodeSelection)
      return state.applyTransaction(state.tr.setSelection(target)).state
    }

    // Left from the start of 'below', with a divider ending the box.
    const up = arrow([title, folded(line('secret'), { type: 'horizontalRule' }), line('below')], 23, -1)
    assert.ok(up.selection.empty, 'none of the hidden text is selected')
    assert.equal(up.selection.head, 9, 'at the end of the heading')

    // Right from the end of the heading, with a divider starting the box.
    const down = arrow([title, folded({ type: 'horizontalRule' }, line('secret')), line('below')], 9, 1)
    assert.ok(down.selection.empty)
    assert.equal(down.selection.$head.parent.textContent, 'below', 'on past the box')
  })

  it("makes a new accordion from the slash menu on a line inside a box, rather than unwrapping the box", () => {
    const title = { type: 'title', content: [{ type: 'text', text: 'N' }] }
    const box = {
      type: 'accordion',
      attrs: { open: true },
      content: [
        { type: 'accordionTitle', content: [{ type: 'text', text: 'Head' }] },
        { type: 'accordionBody', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
      ],
    }
    // Inside 'one', the box's first line.
    const instance = headlessEditor({ type: 'doc', content: [title, box] }, 12)
    assert.equal(instance.commands.toggleAccordion(), true)
    const outer = instance.state.doc.child(1)
    assert.equal(outer.type.name, 'accordion')
    assert.equal(outer.child(0).textContent, 'Head')
    const nested = outer.child(1).child(0)
    assert.equal(nested.type.name, 'accordion')
    assert.equal(nested.child(0).textContent, 'one')
  })

  it('unwraps the accordion from the slash menu in its own heading', () => {
    const title = { type: 'title', content: [{ type: 'text', text: 'N' }] }
    const box = {
      type: 'accordion',
      attrs: { open: true },
      content: [
        { type: 'accordionTitle', content: [{ type: 'text', text: 'Head' }] },
        { type: 'accordionBody', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
      ],
    }
    const instance = headlessEditor({ type: 'doc', content: [title, box] }, 6)
    assert.equal(instance.commands.toggleAccordion(), true)
    assert.deepEqual(
      instance.state.doc.content.content.map((node) => `${node.type.name}:${node.textContent}`),
      ['title:N', 'paragraph:Head', 'paragraph:one'],
    )
  })
})

function bullets(...items: Node[][]) {
  return schema.node('bulletList', null, items.map((content) => schema.node('listItem', null, content)))
}

describe('accordion as a list item', () => {
  it('turns the first line of an item into an accordion', () => {
    const start = page(bullets([paragraph('one')]))
    const { state, applied } = run(start, makeAccordion())
    assert.equal(applied, true)
    state.doc.check()
    const item = state.doc.child(1).child(0)
    assert.equal(item.child(0).type.name, 'accordion')
    assert.equal(item.child(0).child(0).textContent, 'one')
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
  })

  it('brings the heading in as plain text, not bold', () => {
    const bolded = schema.text('one', [schema.marks.bold.create()])
    const start = page(bullets([schema.node('paragraph', null, [bolded])]))
    const { state } = run(start, makeAccordion())
    const heading = state.doc.child(1).child(0).child(0).child(0)
    assert.equal(heading.textContent, 'one')
    heading.forEach((text) => assert.equal(schema.marks.bold.isInSet(text.marks), undefined))

    const blank = run(page(bullets([paragraph()])), makeAccordion()).state
    assert.equal(blank.storedMarks, null)
  })

  it('keeps making plain lines for new items', () => {
    assert.equal(schema.nodes.listItem.createAndFill()!.child(0).type.name, 'paragraph')

    const start = page(bullets([accordion('Details')], [paragraph('two')]))
    const { state, applied } = run(start, splitListItem(schema.nodes.listItem))
    assert.equal(applied, true)
    state.doc.check()
    assert.equal(state.doc.child(1).childCount, 3)
    assert.equal(state.doc.child(1).child(2).child(0).type.name, 'paragraph')
  })

  it('starts the next item on Enter from an empty last line of the box', () => {
    const start = page(bullets([accordion('Details', [paragraph('text'), paragraph()])], [paragraph('after')]))
    // Past the 'text' line, into the blank one under it.
    const at = caretAt(start, inside(start, 'accordionBody', 7))
    const { state, applied } = run(at, leaveAccordion())
    assert.equal(applied, true)
    state.doc.check()
    const list = state.doc.child(1)
    assert.equal(list.childCount, 3)
    assert.equal(list.child(0).child(0).child(1).childCount, 1, 'the blank line went with you')
    assert.equal(list.child(1).childCount, 1)
    assert.equal(list.child(1).child(0).content.size, 0)
    assert.equal(list.child(2).textContent, 'after')
    assert.equal(state.selection.$from.node(-1), list.child(1), 'on the new item')
  })

  it('starts a new first item of what is nested under the item, as Enter does', () => {
    const nested = bullets([paragraph('child')])
    const start = page(bullets([accordion('Details', [paragraph()], false), nested]))
    const at = caretAt(start, inside(start, 'accordionTitle', 7))
    const { state, applied } = run(at, enterAccordionBody())
    assert.equal(applied, true)
    state.doc.check()
    const list = state.doc.child(1)
    assert.equal(list.childCount, 1)
    const sub = list.child(0).child(1)
    assert.equal(sub.childCount, 2)
    assert.equal(sub.child(0).textContent, '')
    assert.equal(sub.child(1).textContent, 'child')
    assert.equal(state.selection.$from.node(-1), sub.child(0))
  })

  it('starts the next item on Enter from a folded heading', () => {
    const start = page(bullets([accordion('Details', [paragraph()], false)]))
    const at = caretAt(start, inside(start, 'accordionTitle', 7))
    const { state, applied } = run(at, enterAccordionBody())
    assert.equal(applied, true)
    state.doc.check()
    const list = state.doc.child(1)
    assert.equal(list.childCount, 2)
    assert.equal(list.child(1).textContent, '')
    assert.equal(state.selection.$from.node(-1), list.child(1), 'on the new item')
  })

  it('deletes an empty heading on Backspace, the first line of the box taking its place in the item', () => {
    const start = page(bullets([paragraph('zero')], [accordion('', [paragraph('one')])]))
    const at = caretAt(start, inside(start, 'accordionTitle'))
    const { state, applied } = run(at, backspaceAccordion())
    assert.equal(applied, true)
    state.doc.check()
    const item = state.doc.child(1).child(1)
    assert.deepEqual(item.children.map((node) => [node.type.name, node.textContent]), [['paragraph', 'one']])
    assert.equal(state.selection.$from.parent.textContent, 'zero')
    assert.equal(state.selection.$from.parentOffset, 'zero'.length)
  })

  it('goes back to an empty plain item where the item would be left with no line', () => {
    const start = page(bullets([accordion('')]))
    const { state, applied } = run(caretAt(start, inside(start, 'accordionTitle')), backspaceAccordion())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(state.doc.child(1).child(0).children.map((node) => node.type.name), ['paragraph'])
  })

  it('jumps up to the item above on Backspace at the start of a heading with words in it', () => {
    const start = page(bullets([paragraph('one')], [accordion('Details')]))
    const heading = inside(start, 'accordionTitle')
    const { state, applied } = run(caretAt(start, heading), backspaceAccordion())
    assert.equal(applied, true)
    assert.equal(state.doc, start.doc)
    assert.equal(state.selection.$from.parent.textContent, 'one')
    assert.equal(state.selection.$from.parentOffset, 'one'.length)
  })

  it('indents and outdents from the heading like any other item', () => {
    const start = page(bullets([paragraph('one')], [accordion('Details')]))
    const at = caretAt(start, inside(start, 'accordionTitle', 2))
    const sunk = run(at, sinkListItem(schema.nodes.listItem))
    assert.equal(sunk.applied, true)
    sunk.state.doc.check()
    const first = sunk.state.doc.child(1).child(0)
    assert.equal(first.child(1).child(0).child(0).type.name, 'accordion')

    const lifted = run(sunk.state, liftListItem(schema.nodes.listItem))
    assert.equal(lifted.applied, true)
    lifted.state.doc.check()
    assert.equal(lifted.state.doc.child(1).child(1).child(0).type.name, 'accordion')
  })

  it('deletes an empty item of a list in the box in one go, up to the item above', () => {
    for (const rest of [[[paragraph('c')]], []]) {
      const start = page(bullets([accordion('Details', [bullets([paragraph('a')], [paragraph()], ...rest)])]))
      let blank = -1
      start.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) blank = pos + 1
      })
      const { state, applied } = run(caretAt(start, blank), backspaceNestedItem())
      assert.equal(applied, true)
      state.doc.check()
      const list = state.doc.child(1).child(0).child(0).child(1).child(0)
      assert.deepEqual(list.content.content.map((item) => item.textContent), ['a', ...rest.map(() => 'c')])
      assert.equal(state.selection.$from.parent.textContent, 'a')
      assert.equal(state.selection.$from.parentOffset, 1)
    }
  })

  it('leaves the first item of a list in the box to lift out, with no item above it', () => {
    const start = page(accordion('Details', [bullets([paragraph()], [paragraph('b')])]))
    const at = caretAt(start, inside(start, 'accordionBody', 3))
    assert.equal(run(at, backspaceNestedItem()).applied, false)
  })

  it('deletes an empty line lifted out of a list in the box, back to the item above', () => {
    // Where Backspace on an empty item of the box's list leaves it.
    const start = page(bullets([accordion('Details', [bullets([paragraph('a')]), paragraph(), bullets([paragraph('c')])])]))
    let blank = -1
    start.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) blank = pos + 1
    })
    const { state, applied } = run(caretAt(start, blank), backspaceAfterList())
    assert.equal(applied, true)
    state.doc.check()
    const body = state.doc.child(1).child(0).child(0).child(1)
    assert.deepEqual(
      body.children.map((node) => node.type.name),
      ['bulletList', 'bulletList'],
    )
    assert.equal(state.selection.$from.parent.textContent, 'a')
    assert.equal(state.selection.$from.parentOffset, 1)
  })

  it('turns a heading drawn as a Title back into a plain first line of the item', () => {
    const titled = schema.node('accordion', null, [
      schema.node('accordionTitle', { title: true }, [schema.text('Plan')]),
      schema.node('accordionBody', null, [paragraph('step')]),
    ])
    const start = page(bullets([titled]))
    const { state, applied } = run(caretAt(start, inside(start, 'accordionTitle', 2)), unwrapAccordion())
    assert.equal(applied, true)
    state.doc.check()
    const item = state.doc.child(1).child(0)
    assert.deepEqual(item.children.map((node) => [node.type.name, node.textContent]), [
      ['paragraph', 'Plan'],
      ['paragraph', 'step'],
    ])
    assert.equal(state.selection.$from.parent.textContent, 'Plan')
  })

  it('jumps to the end of a folded heading from the next line of the item', () => {
    const start = page(bullets([accordion('Details', [paragraph('hidden')], false), paragraph('next')]))
    const at = caretAt(start, inside(start, 'paragraph', 0) + 'hidden'.length + 4)
    assert.equal(at.selection.$from.parent.textContent, 'next')
    const { state, applied } = run(at, backspaceAfterFolded())
    assert.equal(applied, true)
    assert.equal(state.selection.$from.parent.type.name, 'accordionTitle')
  })

  it('survives the trip through Yjs', () => {
    const state = page(bullets([accordion('Details', [paragraph('hidden')], false)]))
    const ydoc = new Y.Doc()
    const fragment = ydoc.getXmlFragment('test')
    prosemirrorToYXmlFragment(state.doc, fragment)
    const back = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    back.check()
    assert.ok(back.eq(state.doc))
  })
})
