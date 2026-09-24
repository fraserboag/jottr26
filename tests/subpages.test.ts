import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Subpages } from '@/components/editor/extensions/subpages'
import { filterSlashItems } from '@/components/editor/extensions/slash'

/** A headless editor with the caret at the start of block `index`. */
function editor(blocks: JSONContent[], index: number) {
  const instance = new Editor({
    element: null,
    extensions: [StarterKit.configure({ undoRedo: false, heading: false }), Subpages],
    content: { type: 'doc', content: blocks },
  })
  instance.commands.command(({ tr }) => {
    let pos = 0
    for (let i = 0; i < index; i += 1) pos += tr.doc.child(i).nodeSize
    tr.setSelection(TextSelection.create(tr.doc, pos + 1))
    return true
  })
  return instance
}

const paragraph = (text?: string): JSONContent =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }

const blockTypes = (instance: Editor) => instance.getJSON().content?.map((block) => block.type)

describe('subpage list', () => {
  it('takes the place of the empty line it was asked for on', () => {
    const instance = editor([paragraph('Intro'), paragraph(), paragraph('After')], 1)
    instance.commands.insertSubpages()
    assert.deepEqual(blockTypes(instance), ['paragraph', 'subpages', 'paragraph'])
    // The caret moves on to the line below rather than back up into the intro.
    assert.equal(instance.state.selection.$from.parent.textContent, 'After')
  })

  it('leaves a line to carry on typing on at the foot of a page', () => {
    const instance = editor([paragraph('Intro'), paragraph()], 1)
    instance.commands.insertSubpages()
    assert.deepEqual(blockTypes(instance), ['paragraph', 'subpages', 'paragraph'])
    const { $from } = instance.state.selection
    assert.equal($from.parent.type.name, 'paragraph')
    assert.equal($from.index(0), 2)
  })

  it('holds nothing of its own, so there is nothing in it to edit or sync', () => {
    const instance = editor([paragraph()], 0)
    instance.commands.insertSubpages()
    const node = instance.state.doc.child(0)
    assert.equal(node.type.name, 'subpages')
    assert.equal(node.isAtom, true)
    assert.equal(node.content.size, 0)
    assert.equal(Object.keys(node.attrs).length, 0)
  })

  it('is in the slash menu', () => {
    for (const query of ['sub', 'Subpages', 'children', 'pages']) {
      assert.equal(
        filterSlashItems(query).some((item) => item.id === 'subpages'),
        true,
        `'${query}' should find the subpage list`,
      )
    }
  })
})
