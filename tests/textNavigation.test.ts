import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JSONContent } from '@tiptap/core'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { moveToDocumentBoundary, moveToLineBoundary } from '@/components/editor/extensions/textNavigation'
import { textCaretSide } from '@/components/editor/extensions/textCaret'
import { headlessEditor } from './editor'

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const paragraph = (value: string): JSONContent => ({ type: 'paragraph', content: [text(value)] })

function editor(...body: JSONContent[]) {
  return headlessEditor({ type: 'doc', content: [{ type: 'title', content: [text('Notes')] }, ...body] }, 1)
}

function press(instance: ReturnType<typeof editor>, key: string, modifiers: Partial<KeyboardEvent> = {}) {
  const event = { key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...modifiers }
  const view = { state: instance.state, dispatch: instance.view.dispatch }
  return instance.extensionManager.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, view as never, event as KeyboardEvent),
  )
}

function select(instance: ReturnType<typeof editor>, anchor: number, head = anchor) {
  instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, anchor, head)))
}

describe('text navigation', () => {
  it('Home/End (Fn-Left/Right) and Cmd-Left/Right move to line edges', () => {
    const instance = editor(paragraph('first line'), paragraph('second'))
    for (const [key, modifiers, expected] of [
      ['Home', {}, 8], ['End', {}, 18],
      ['ArrowLeft', { metaKey: true }, 8], ['ArrowRight', { metaKey: true }, 18],
    ] as const) {
      select(instance, 12)
      const before = instance.state.doc
      assert.ok(press(instance, key, modifiers), key)
      assert.equal(instance.state.selection.head, expected, key)
      assert.ok(instance.state.selection.empty)
      assert.equal(instance.state.doc, before, 'navigation leaves content untouched')
    }
  })

  it('Shift extends and reverses a line selection while keeping its anchor', () => {
    const instance = editor(paragraph('first line'))
    for (const metaKey of [false, true]) {
      select(instance, 12)
      assert.ok(press(instance, metaKey ? 'ArrowLeft' : 'Home', { shiftKey: true, metaKey }))
      assert.equal(instance.state.selection.anchor, 12)
      assert.equal(instance.state.selection.head, 8)
      assert.ok(press(instance, metaKey ? 'ArrowRight' : 'End', { shiftKey: true, metaKey }))
      assert.equal(instance.state.selection.anchor, 12)
      assert.equal(instance.state.selection.head, 18)
    }
  })

  it('moves from the active end of a selection spanning lines', () => {
    const instance = editor(paragraph('first line'), paragraph('second'))
    select(instance, 10, 23)
    press(instance, 'Home')
    assert.equal(instance.state.selection.head, 20)
    assert.ok(instance.state.selection.empty)
    select(instance, 23, 10)
    press(instance, 'End', { shiftKey: true })
    assert.equal(instance.state.selection.anchor, 23)
    assert.equal(instance.state.selection.head, 18)
  })

  it('uses visual line edges without letting WebKit reverse the selection anchor', () => {
    const instance = editor(paragraph('a long paragraph spanning multiple visual lines'))
    select(instance, 28, 13)
    const node = {} as globalThis.Node
    const native = {
      anchorNode: node, focusNode: node, anchorOffset: 20, focusOffset: 5, isCollapsed: false,
      collapse(_node: globalThis.Node, offset: number) {
        this.anchorOffset = this.focusOffset = offset
        this.isCollapsed = true
      },
      modify(alter: string) {
        // WebKit's extend can move the anchor instead of the active end.
        if (alter === 'extend') this.anchorOffset = 40
        else this.anchorOffset = this.focusOffset = 40
      },
      setBaseAndExtent(_anchor: globalThis.Node, anchor: number, _head: globalThis.Node, head: number) {
        this.anchorOffset = anchor
        this.focusOffset = head
        this.isCollapsed = anchor === head
      },
    }
    const view = {
      dom: { ownerDocument: { getSelection: () => native }, contains: () => true },
      posAtDOM: (_node: globalThis.Node, offset: number) => 8 + offset,
    } as unknown as EditorView
    assert.ok(moveToLineBoundary(1, true)(instance.state, instance.view.dispatch, view))
    assert.equal(instance.state.selection.anchor, 28)
    assert.equal(instance.state.selection.head, 48, 'the visual edge, rather than the paragraph end')
    assert.equal(native.anchorOffset, 20)
    assert.equal(native.focusOffset, 40)
  })

  it('draws line starts after the wrap and line ends before it in paragraphs and list items', () => {
    for (const block of [
      paragraph('first line and its wrapped continuation'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('first line and its wrapped continuation')] }] },
    ]) {
      const instance = editor(block)
      let state = EditorState.create({ doc: instance.state.doc, plugins: instance.extensionManager.plugins })
      let start = 0
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph') start = pos + 1
      })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + 20)))
      const dispatch = (tr: Parameters<typeof state.apply>[0]) => { state = state.applyTransaction(tr).state }

      moveToLineBoundary(-1)(state, dispatch)
      assert.equal(textCaretSide.getState(state), 1, 'Home draws using the text after the caret')
      moveToLineBoundary(-1)(state, dispatch)
      assert.equal(textCaretSide.getState(state), 1, 'repeated Home keeps the caret on that line')
      moveToLineBoundary(1)(state, dispatch)
      assert.equal(textCaretSide.getState(state), -1, 'End draws using the text before the caret')
      state = state.apply(state.tr.setMeta('unrelated', true))
      assert.equal(textCaretSide.getState(state), -1, 'bookkeeping preserves the line side')
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + 2)))
      assert.equal(textCaretSide.getState(state), null, 'other cursor movement uses the native position again')
      moveToLineBoundary(-1)(state, dispatch)
      state = state.apply(state.tr.insertText('x'))
      assert.equal(textCaretSide.getState(state), null, 'typing clears the line side')
    }
  })

  it('works in the title and empty paragraphs', () => {
    const instance = editor({ type: 'paragraph' })
    select(instance, 3)
    press(instance, 'Home')
    assert.equal(instance.state.selection.head, 1)
    press(instance, 'End', { shiftKey: true })
    assert.equal(instance.state.selection.head, 6)
    select(instance, 8)
    assert.ok(press(instance, 'Home'))
    assert.ok(press(instance, 'End'))
    assert.equal(instance.state.selection.head, 8)
  })

  it('keeps navigation on the current code line or Shift-Enter line', () => {
    for (const block of [
      { type: 'codeBlock', content: [text('first\nsecond\nthird')] },
      { type: 'paragraph', content: [text('first'), { type: 'hardBreak' }, text('second'), { type: 'hardBreak' }, text('third')] },
    ]) {
      const instance = editor(block)
      select(instance, 17)
      press(instance, 'Home')
      assert.equal(instance.state.selection.head, 14)
      press(instance, 'End')
      assert.equal(instance.state.selection.head, 20)
    }
    const instance = editor({ type: 'codeBlock', content: [text('\nsecond')] })
    select(instance, 8)
    press(instance, 'Home')
    assert.equal(instance.state.selection.head, 8, 'an empty first line stays on that line')
  })

  it('Cmd-Up/Down and Ctrl/Cmd-Home/End reach document edges, with Shift selection', () => {
    const instance = editor(paragraph('first line'), { type: 'horizontalRule' }, paragraph('second'), { type: 'horizontalRule' })
    for (const [key, modifiers, expected] of [
      ['ArrowUp', { metaKey: true }, 1], ['ArrowDown', { metaKey: true }, 27],
      ['Home', { ctrlKey: true }, 1], ['End', { ctrlKey: true }, 27],
      ['Home', { metaKey: true }, 1], ['End', { metaKey: true }, 27],
    ] as const) {
      for (const shiftKey of [false, true]) {
        select(instance, 12)
        assert.ok(press(instance, key, { ...modifiers, shiftKey }))
        assert.equal(instance.state.selection.head, expected, key)
        assert.equal(instance.state.selection.anchor, shiftKey ? 12 : expected)
      }
    }
  })

  it('reaches text inside a table at the end of the document', () => {
    const instance = editor(paragraph('first line'), {
      type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('cell text')] }] }],
    })
    press(instance, 'End', { ctrlKey: true })
    assert.equal(instance.state.selection.$head.parent.textContent, 'cell text')
    assert.equal(instance.state.selection.$head.parentOffset, 9)
    press(instance, 'Home')
    assert.equal(instance.state.selection.$head.parentOffset, 0)
  })

  it('does not place the caret in a folded accordion at the end of the document', () => {
    const instance = editor(paragraph('first line'), {
      type: 'accordion', attrs: { open: false }, content: [
        { type: 'accordionTitle', content: [text('Section')] },
        { type: 'accordionBody', content: [paragraph('hidden')] },
      ],
    })
    select(instance, 11)
    // Headless Tiptap does not install plugins; include them here so folded
    // sections get the same selection repair they do in the mounted editor.
    let state = EditorState.create({
      doc: instance.state.doc, selection: instance.state.selection, plugins: instance.extensionManager.plugins,
    })
    assert.ok(moveToDocumentBoundary(1, true)(state, (tr) => { state = state.applyTransaction(tr).state }))
    assert.equal(state.selection.$head.parent.type.name, 'accordionTitle')
    assert.equal(state.selection.anchor, 11)
  })

  it('leaves word navigation, Shift-arrows and PageUp/Down to the browser', () => {
    const instance = editor(paragraph('first line'))
    for (const [key, modifiers] of [
      ['ArrowLeft', { altKey: true }], ['ArrowRight', { ctrlKey: true }],
      ['ArrowLeft', { shiftKey: true }], ['ArrowRight', { altKey: true, shiftKey: true }],
      ['PageUp', {}], ['PageDown', { shiftKey: true }],
    ] as const) {
      const before = instance.state
      assert.equal(press(instance, key, modifiers), false, key)
      assert.equal(instance.state, before)
    }
  })

  it('declines line navigation from a block selection and does not dispatch on a dry run', () => {
    const instance = editor(paragraph('first line'), { type: 'horizontalRule' })
    const before = instance.state
    assert.ok(moveToLineBoundary(-1)(instance.state))
    assert.equal(instance.state, before)
    instance.view.dispatch(instance.state.tr.setSelection(NodeSelection.create(instance.state.doc, 19)))
    assert.equal(moveToLineBoundary(-1)(instance.state), false)
  })
})
