import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskList } from '@tiptap/extension-list'
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { AccordionKit } from '@/components/editor/extensions/accordion'
import { backspaceNestedItem, enterNestedList, ListItem, TaskItem } from '@/components/editor/extensions/lists'
import { JottrDocument, Title } from '@/components/editor/extensions/title'

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false, listItem: false }),
  ListItem,
  TaskList,
  TaskItem,
  ...AccordionKit,
])

function paragraph(text?: string) {
  return schema.node('paragraph', null, text ? [schema.text(text)] : [])
}

function list(type: string, ...items: Node[][]) {
  const item = type === 'taskList' ? 'taskItem' : 'listItem'
  return schema.node(type, null, items.map((content) => schema.node(item, null, content)))
}

/** A page holding the given body blocks, with the caret just after `text`. */
function caretAfter(text: string, ...body: Node[]) {
  const doc = schema.node('doc', null, [schema.node('title', null, schema.text('Notes')), ...body])
  let at = -1
  doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.startsWith(text)) at = pos + text.length
    return at < 0
  })
  const state = EditorState.create({ doc, schema })
  return state.apply(state.tr.setSelection(TextSelection.create(doc, at)))
}

function run(state: EditorState, command: Command) {
  let next = state
  const applied = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { state: next, applied }
}

describe('Enter in a list', () => {
  it('starts a new first item of the ones nested under this item, at their level', () => {
    for (const type of ['bulletList', 'orderedList', 'taskList']) {
      const start = caretAfter('parent', list(type, [paragraph('parent'), list(type, [paragraph('one')], [paragraph('two')])]))
      const { state, applied } = run(start, enterNestedList())
      assert.equal(applied, true)
      state.doc.check()
      const top = state.doc.child(1)
      assert.equal(top.childCount, 1, 'no new item at the upper level')
      const sub = top.child(0).child(1)
      assert.deepEqual(
        sub.content.content.map((item) => item.textContent),
        ['', 'one', 'two'],
      )
      assert.equal(state.selection.$from.node(-1), sub.child(0), 'on the new item')
    }
  })

  it('makes the new item the kind already nested there', () => {
    const start = caretAfter('parent', list('bulletList', [paragraph('parent'), list('taskList', [paragraph('todo')])]))
    const { state } = run(start, enterNestedList())
    state.doc.check()
    const first = state.doc.child(1).child(0).child(1).child(0)
    assert.equal(first.type.name, 'taskItem')
    assert.equal(first.attrs.checked, false)
  })

  it('leaves Enter to split the item everywhere else', () => {
    // Nothing nested under it.
    assert.equal(run(caretAfter('solo', list('bulletList', [paragraph('solo')])), enterNestedList()).applied, false)
    // Mid-line, where the rest of the line becomes the next item.
    const nested = list('bulletList', [paragraph('parent'), list('bulletList', [paragraph('one')])])
    assert.equal(run(caretAfter('par', nested), enterNestedList()).applied, false)
    // Not in a list at all.
    assert.equal(run(caretAfter('text', paragraph('text')), enterNestedList()).applied, false)
  })
})

/** The same page with the caret on its first empty line. */
function onEmptyLine(state: EditorState) {
  let at = -1
  state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'paragraph' && node.content.size === 0) at = pos + 1
    return at < 0
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

describe('Backspace in a nested list', () => {
  it('takes back the item Enter made, leaving the ones under it where they were', () => {
    for (const type of ['bulletList', 'orderedList', 'taskList']) {
      const start = caretAfter('parent', list(type, [paragraph('parent'), list(type, [paragraph('one')], [paragraph('two')])]))
      const made = run(start, enterNestedList()).state
      const { state, applied } = run(made, backspaceNestedItem())
      assert.equal(applied, true)
      state.doc.check()
      assert.ok(state.doc.eq(start.doc), 'back to how it was')
      assert.equal(state.selection.from, start.selection.from, 'at the end of the parent line')
    }
  })

  it('goes to the end of the line above from an empty item further down', () => {
    const start = onEmptyLine(
      caretAfter('parent', list('bulletList', [paragraph('parent'), list('bulletList', [paragraph('one')], [paragraph()], [paragraph('two')])])),
    )
    const { state, applied } = run(start, backspaceNestedItem())
    assert.equal(applied, true)
    const sub = state.doc.child(1).child(0).child(1)
    assert.deepEqual(sub.content.content.map((item) => item.textContent), ['one', 'two'])
    assert.equal(state.selection.$from.parent.textContent, 'one')
    assert.equal(state.selection.$from.parentOffset, 3)
  })

  it('leaves Backspace to lift the item out everywhere else', () => {
    // The last nested item: nothing after it to carry along.
    const last = onEmptyLine(caretAfter('parent', list('bulletList', [paragraph('parent'), list('bulletList', [paragraph('one')], [paragraph()])])))
    assert.equal(run(last, backspaceNestedItem()).applied, false)
    // An item at the top level.
    const top = onEmptyLine(caretAfter('one', list('bulletList', [paragraph()], [paragraph('one')])))
    assert.equal(run(top, backspaceNestedItem()).applied, false)
    // A line with words on it.
    const words = caretAfter('one', list('bulletList', [paragraph('parent'), list('bulletList', [paragraph('one')], [paragraph('two')])]))
    assert.equal(run(words, backspaceNestedItem()).applied, false)
  })
})
