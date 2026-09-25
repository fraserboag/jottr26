import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor, type JSONContent } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { FormattingMarks } from '@/components/editor/extensions/marks'

/** A headless editor with the page's marks, the caret at the end of `blocks`.
 *  Which marks a split keeps is the editor's business, not the schema's, so
 *  this needs a real Editor rather than a bare EditorState. */
function editor(...blocks: JSONContent[]) {
  const instance = new Editor({
    element: null,
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        heading: false,
        blockquote: false,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        code: false,
      }),
      ...FormattingMarks,
    ],
    content: { type: 'doc', content: blocks },
  })
  // focus('end') needs a view to move the caret, and this editor has none.
  instance.commands.command(({ tr }) => {
    tr.setSelection(Selection.atEnd(tr.doc))
    return true
  })
  return instance
}

function text(value: string, ...marks: string[]): JSONContent {
  return { type: 'text', text: value, marks: marks.map((type) => ({ type })) }
}

function paragraph(...content: JSONContent[]): JSONContent {
  return { type: 'paragraph', content }
}

/** Type the way a keystroke does, picking up whatever marks are live. */
function type(instance: Editor, value: string) {
  instance.commands.command(({ tr }) => {
    tr.insertText(value)
    return true
  })
}

/** The marks on the text just typed, by name. */
function marksBehindCaret(instance: Editor) {
  const { $from } = instance.state.selection
  return (($from.nodeBefore?.marks ?? []).map((mark) => mark.type.name)).sort()
}

describe('Enter and formatting', () => {
  for (const mark of ['bold', 'italic', 'underline', 'strike', 'code']) {
    it(`starts the next line without ${mark}`, () => {
      const instance = editor(paragraph(text('Heading', mark)))
      instance.commands.splitBlock()
      type(instance, 'plain')
      assert.deepEqual(marksBehindCaret(instance), [])
      instance.destroy()
    })
  }

  it('drops every style at once', () => {
    const instance = editor(paragraph(text('Loud', 'bold', 'italic', 'underline')))
    instance.commands.splitBlock()
    type(instance, 'plain')
    assert.deepEqual(marksBehindCaret(instance), [])
    instance.destroy()
  })

  it('drops a style switched on but not yet typed with', () => {
    const instance = editor(paragraph(text('Before ')))
    instance.commands.setBold()
    instance.commands.splitBlock()
    type(instance, 'plain')
    assert.deepEqual(marksBehindCaret(instance), [])
    instance.destroy()
  })

  it('leaves the line it split from as it was', () => {
    const instance = editor(paragraph(text('Heading', 'bold')))
    instance.commands.splitBlock()
    assert.deepEqual(instance.getJSON().content?.[0], paragraph(text('Heading', 'bold')))
    instance.destroy()
  })

  it('starts the next list item plain', () => {
    const instance = editor({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(text('First', 'bold'))] }],
    })
    instance.commands.splitListItem('listItem')
    type(instance, 'plain')
    assert.deepEqual(marksBehindCaret(instance), [])
    instance.destroy()
  })

  it('still keeps typing bold on the same line', () => {
    const instance = editor(paragraph(text('Heading', 'bold')))
    type(instance, ' more')
    assert.deepEqual(marksBehindCaret(instance), ['bold'])
    instance.destroy()
  })
})
