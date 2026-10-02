import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getExtensionField, getSchemaTypeByName, type KeyboardShortcutCommand } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { backspaceNestedItem, enterNestedList, nestedList, sinkAcrossAdjacentLists, sinkFromFirstItem } from '@/components/editor/extensions/lists'
import { headlessEditor, pageSchema as schema, paragraph, run } from './editor'

function list(type: string, ...items: Node[][]) {
  return schema.node(type, null, items.map((content) => schema.node('listItem', null, content)))
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

describe('Enter in a list', () => {
  it('starts a new first item of the ones nested under this item, at their level', () => {
    for (const type of ['bulletList', 'orderedList']) {
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
    for (const type of ['bulletList', 'orderedList']) {
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

/** A page holding the given body blocks, with its first line to `to` selected
 *  — the way a drag down a list from its top row selects it. */
function selecting(from: string, to: string, ...body: Node[]) {
  const start = caretAfter(from, ...body)
  const end = caretAfter(to, ...body)
  return start.apply(start.tr.setSelection(TextSelection.create(start.doc, start.selection.from - from.length, end.selection.from)))
}

/** A list as an outline: each item's words, indented by its depth. */
function outlineOf(node: Node, depth = 0): string[] {
  return node.content.content.flatMap((item) => [
    '  '.repeat(depth) + item.firstChild!.textContent,
    ...(nestedList(item) ? outlineOf(nestedList(item)!, depth + 1) : []),
  ])
}

/** Send the key through the page's plugins in the same order as the view. */
function pressTab(instance: ReturnType<typeof headlessEditor>, shiftKey = false) {
  const event = { key: 'Tab', keyCode: 9, shiftKey, altKey: false, ctrlKey: false, metaKey: false }
  const view = { state: instance.state, dispatch: instance.view.dispatch }
  return instance.extensionManager.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, view as never, event as KeyboardEvent),
  )
}

describe('Tab and Shift-Tab with the caret anywhere in a list item', () => {
  for (const type of ['bulletList', 'orderedList']) {
    for (const offset of [0, 2, 5]) {
      it(`indents and outdents a ${type} at text offset ${offset}`, () => {
        const start = caretAfter('child', list(type, [paragraph('parent')], [paragraph('child')], [paragraph('after')]))
        const instance = headlessEditor(start.doc.toJSON(), start.selection.from - 5 + offset)
        const before = instance.state.doc
        assert.equal(pressTab(instance), true)
        instance.state.doc.check()
        assert.deepEqual(outlineOf(instance.state.doc.child(1)), ['parent', '  child', 'after'])
        assert.equal(instance.state.selection.$from.parentOffset, offset, 'caret stays on the same character')
        assert.equal(pressTab(instance, true), true)
        instance.state.doc.check()
        assert.ok(instance.state.doc.eq(before), 'Shift-Tab restores the original nesting')
        assert.equal(instance.state.selection.$from.parentOffset, offset)
        instance.destroy()
      })
    }
  }

  it('keeps working deep in mixed lists with children already nested under the item', () => {
    let nested = list('orderedList', [paragraph('above')], [paragraph('target'), list('bulletList', [paragraph('child')])], [paragraph('below')])
    for (let depth = 0; depth < 10; depth++) {
      nested = list(depth % 2 ? 'orderedList' : 'bulletList', [paragraph(`parent ${depth}`), nested])
    }
    const start = caretAfter('tar', nested)
    const instance = headlessEditor(start.doc.toJSON(), start.selection.from)
    const before = instance.state.doc
    const originalDepth = instance.state.selection.$from.depth
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.equal(pressTab(instance), true)
      instance.state.doc.check()
      assert.equal(instance.state.selection.$from.depth, originalDepth + 2)
      assert.equal(instance.state.selection.$from.parent.textContent, 'target')
      assert.equal(instance.state.selection.$from.parentOffset, 3)
      assert.equal(pressTab(instance, true), true)
      instance.state.doc.check()
      assert.ok(instance.state.doc.eq(before), 'the subtree survives each indent/outdent pair')
    }
    instance.destroy()
  })

  for (const type of ['bulletList', 'orderedList']) {
    for (const offset of [0, 2, 5]) {
      it(`indents across adjacent ${type} containers at text offset ${offset}`, () => {
        // Separate lists can look like one continuous list at the same level.
        const start = caretAfter('child', list('bulletList', [
          paragraph('parent'),
          list(type, [paragraph('above')]),
          list(type, [paragraph('child'), list(type, [paragraph('descendant')])], [paragraph('after')]),
        ]))
        const instance = headlessEditor(start.doc.toJSON(), start.selection.from - 5 + offset)
        const originalDepth = instance.state.selection.$from.depth
        assert.equal(pressTab(instance), true)
        instance.state.doc.check()
        assert.equal(instance.state.selection.$from.depth, originalDepth + 2, 'under the item above in the adjacent list')
        assert.equal(instance.state.selection.$from.parent.textContent, 'child')
        assert.equal(instance.state.selection.$from.parentOffset, offset)
        assert.deepEqual(outlineOf(instance.state.doc.child(1)), ['parent', '  above', '    child', '      descendant', '  after'])
        assert.equal(pressTab(instance, true), true)
        instance.state.doc.check()
        assert.deepEqual(outlineOf(instance.state.doc.child(1)), ['parent', '  above', '  child', '    descendant', '  after'])
        assert.equal(instance.state.selection.$from.parentOffset, offset)
        instance.destroy()
      })
    }
  }
})

describe('Tab over several items', () => {
  it('takes every selected item under the last item of an adjacent list', () => {
    const start = selecting('b', 'c',
      list('bulletList', [paragraph('a')]),
      list('bulletList', [paragraph('b')], [paragraph('c')], [paragraph('d')]),
    )
    const instance = headlessEditor(start.doc.toJSON(), start.selection.from)
    instance.commands.command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, start.selection.from, start.selection.to))
      return true
    })
    assert.equal(pressTab(instance), true)
    instance.state.doc.check()
    assert.deepEqual(outlineOf(instance.state.doc.child(1)), ['a', '  b', '  c', 'd'])
    assert.equal(instance.state.doc.textBetween(instance.state.selection.from, instance.state.selection.to, '|'), 'b|c')
    assert.equal(pressTab(instance, true), true)
    instance.state.doc.check()
    assert.deepEqual(outlineOf(instance.state.doc.child(1)), ['a', 'b', 'c', 'd'])
    instance.destroy()
  })

  it('takes the rest under the first, when the selection starts on it', () => {
    for (const type of ['bulletList', 'orderedList']) {
      const start = selecting('a', 'c', list(type, [paragraph('a')], [paragraph('b')], [paragraph('c')], [paragraph('d')]))
      const { state, applied } = run(start, sinkFromFirstItem())
      assert.equal(applied, true)
      state.doc.check()
      assert.deepEqual(outlineOf(state.doc.child(1)), ['a', '  b', '  c', 'd'])
      assert.equal(state.doc.textBetween(state.selection.from, state.selection.to, '|'), 'a|b|c', 'still selected')
    }
  })

  it('joins them to a list already under the first', () => {
    const start = selecting('a', 'c', list('bulletList', [paragraph('a'), list('bulletList', [paragraph('a1')])], [paragraph('b')], [paragraph('c')]))
    const { state, applied } = run(start, sinkFromFirstItem())
    assert.equal(applied, true)
    state.doc.check()
    assert.deepEqual(outlineOf(state.doc.child(1)), ['a', '  a1', '  b', '  c'])
  })

  it('does the same from the first item of a nested list', () => {
    const start = selecting('b1', 'b2', list('bulletList', [paragraph('a'), list('bulletList', [paragraph('b1')], [paragraph('b2')])]))
    const { state, applied } = run(start, sinkFromFirstItem())
    assert.equal(applied, true)
    assert.deepEqual(outlineOf(state.doc.child(1)), ['a', '  b1', '    b2'])
  })

  it('leaves the rest to Tiptap', () => {
    const items = () => list('bulletList', [paragraph('a')], [paragraph('b')], [paragraph('c')])
    // Items further down, which Tiptap nests every one of.
    assert.equal(run(selecting('b', 'c', items()), sinkFromFirstItem()).applied, false)
    // The first item alone, with nothing else to take under it.
    assert.equal(run(selecting('a', 'a', items()), sinkFromFirstItem()).applied, false)
    assert.equal(run(caretAfter('a', items()), sinkFromFirstItem()).applied, false)
  })
})

describe('adjacent list boundaries', () => {
  it('declines across a different list kind or a separating paragraph', () => {
    const current = list('bulletList', [paragraph('target')])
    for (const body of [
      [list('orderedList', [paragraph('above')]), current],
      [list('bulletList', [paragraph('above')]), paragraph(), current],
    ]) {
      const start = caretAfter('tar', ...body)
      const { applied, state } = run(start, sinkAcrossAdjacentLists())
      assert.equal(applied, false)
      assert.ok(state.doc.eq(start.doc))
    }
  })
})

describe('Tab in a list item that can go no further', () => {
  it('keeps the key, so focus stays in the page', () => {
    const item = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const doc = {
      type: 'doc',
      content: [{ type: 'title', content: [{ type: 'text', text: 'N' }] }, { type: 'bulletList', content: [item('a'), item('b')] }],
    }
    // The caret in `a`, the first item: nothing above it to go under.
    const instance = headlessEditor(doc, 7)
    const extension = instance.extensionManager.extensions.find((candidate) => candidate.name === 'listItem')!
    const keys = getExtensionField<() => Record<string, KeyboardShortcutCommand>>(extension, 'addKeyboardShortcuts', {
      name: 'listItem',
      options: extension.options,
      storage: extension.storage,
      editor: instance,
      type: getSchemaTypeByName('listItem', instance.schema),
    })()
    const before = instance.state.doc
    assert.equal(keys.Tab({ editor: instance }), true)
    assert.ok(instance.state.doc.eq(before), 'the list is left as it was')
  })
})

describe('list and table keys on a plain line', () => {
  it('decline without dispatching an empty edit through every plugin', () => {
    const line = { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }
    const instance = headlessEditor({ type: 'doc', content: [{ type: 'title', content: [{ type: 'text', text: 'N' }] }, line] }, 6)
    let dispatched = 0
    instance.on('transaction', () => (dispatched += 1))
    for (const name of ['listItem', 'table']) {
      const extension = instance.extensionManager.extensions.find((candidate) => candidate.name === name)!
      const keys = getExtensionField<() => Record<string, KeyboardShortcutCommand>>(extension, 'addKeyboardShortcuts', {
        name,
        options: extension.options,
        storage: extension.storage,
        editor: instance,
        type: getSchemaTypeByName(name, instance.schema),
      })()
      for (const key of ['Enter', 'Tab', 'Shift-Tab']) {
        if (!keys[key]) continue
        assert.equal(keys[key]({ editor: instance }), false, `${name} ${key}`)
        assert.equal(dispatched, 0, `${name} ${key} dispatched`)
      }
    }
  })
})
