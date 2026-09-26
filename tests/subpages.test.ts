import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { Heading } from '@/components/editor/extensions/heading'
import { backspaceSubpagesTitle, leaveSubpagesTitle, Subpages, SubpagesTitle } from '@/components/editor/extensions/subpages'
import { filterSlashItems } from '@/components/editor/extensions/slash'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { repairSubpageTitles } from '@/lib/db/subpages'
import { DOC_FIELD } from '@/lib/db/ydoc'

/** A headless editor with the caret at the start of block `index`. */
function editor(blocks: JSONContent[], index: number) {
  const instance = new Editor({
    element: null,
    extensions: [StarterKit.configure({ undoRedo: false, heading: false }), Heading, Subpages, SubpagesTitle],
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

const subpages = (text = 'Subpages'): JSONContent => ({
  type: 'subpages',
  content: [{ type: 'subpagesTitle', content: [{ type: 'text', text }] }],
})

/** The caret `offset` characters into the heading of the block at `index`. */
function inTitle(instance: Editor, index: number, offset = 0) {
  instance.commands.command(({ tr }) => {
    let pos = 0
    for (let i = 0; i < index; i += 1) pos += tr.doc.child(i).nodeSize
    tr.setSelection(TextSelection.create(tr.doc, pos + 2 + offset))
    return true
  })
}

describe('subpage list', () => {
  it('takes the place of the empty line it was asked for on', () => {
    const instance = editor([paragraph('Intro'), paragraph(), paragraph('After')], 1)
    instance.commands.insertSubpages()
    assert.deepEqual(blockTypes(instance), ['paragraph', 'subpages', 'paragraph'])
  })

  it('puts the caret at the end of its new heading', () => {
    const instance = editor([paragraph('Intro'), paragraph()], 1)
    instance.commands.insertSubpages()
    const { $from, empty } = instance.state.selection
    assert.equal(empty, true)
    assert.equal($from.parent.type.name, 'subpagesTitle')
    assert.equal($from.parentOffset, 'Subpages'.length)
  })

  it('holds its heading, saying Subpages in bold to start with, and its depth', () => {
    const instance = editor([paragraph()], 0)
    instance.commands.insertSubpages()
    const node = instance.state.doc.child(0)
    assert.equal(node.type.name, 'subpages')
    assert.equal(node.childCount, 1)
    const title = node.child(0)
    assert.equal(title.type.name, 'subpagesTitle')
    assert.equal(title.attrs.title, false)
    assert.equal(title.textContent, 'Subpages')
    assert.deepEqual(title.firstChild!.marks.map((mark) => mark.type.name), ['bold'])
    assert.deepEqual({ ...node.attrs }, { depth: 1 })
  })

  it('switches its heading between text and a Title, staying a subpage list', () => {
    const instance = editor([subpages(), paragraph()], 1)
    inTitle(instance, 0, 2)
    instance.commands.toggleTitle()
    assert.deepEqual(blockTypes(instance), ['subpages', 'paragraph'])
    assert.equal(instance.state.doc.child(0).child(0).attrs.title, true)
    assert.ok(instance.isActive('subpagesTitle', { title: true }))
    instance.commands.toggleTitle()
    assert.equal(instance.state.doc.child(0).child(0).attrs.title, false)
  })

  it('can have its heading emptied altogether', () => {
    const instance = editor([subpages(), paragraph()], 1)
    instance.commands.setTextSelection({ from: 2, to: 2 + 'Subpages'.length })
    instance.commands.deleteSelection()
    const node = instance.state.doc.child(0)
    assert.equal(node.type.name, 'subpages')
    assert.equal(node.childCount, 1)
    assert.equal(node.textContent, '')
  })

  it('has a heading that is written in like any other line, marks and all', () => {
    const instance = editor([subpages(), paragraph()], 1)
    inTitle(instance, 0, 'Subpages'.length)
    instance.commands.insertContent({ type: 'text', text: ' index' })
    instance.commands.setTextSelection({ from: 2, to: 2 + 'Subpages'.length })
    instance.commands.toggleBold()
    const title = instance.state.doc.child(0).child(0)
    assert.equal(title.textContent, 'Subpages index')
    assert.deepEqual(title.firstChild!.marks.map((mark) => mark.type.name), ['bold'])
  })

  it('goes on to the line below on Enter, rather than splitting the heading', () => {
    const instance = editor([paragraph('Intro'), subpages(), paragraph('After')], 0)
    inTitle(instance, 1, 3)
    assert.equal(instance.commands.command(({ state, dispatch }) => leaveSubpagesTitle()(state, dispatch)), true)
    assert.deepEqual(blockTypes(instance), ['paragraph', 'subpages', 'paragraph'])
    assert.equal(instance.state.doc.child(1).textContent, 'Subpages')
    assert.equal(instance.state.selection.$from.parent.textContent, 'After')
  })

  it('makes a line to go on to on Enter at the foot of a page', () => {
    const instance = editor([paragraph('Intro'), subpages()], 0)
    inTitle(instance, 1)
    instance.commands.command(({ state, dispatch }) => leaveSubpagesTitle()(state, dispatch))
    assert.deepEqual(blockTypes(instance), ['paragraph', 'subpages', 'paragraph'])
    assert.equal(instance.state.selection.$from.index(0), 2)
  })

  it('jumps up to the end of the line above on Backspace at the start of the heading', () => {
    const instance = editor([paragraph('Intro'), subpages(), paragraph('After')], 0)
    inTitle(instance, 1)
    assert.equal(instance.commands.command(({ state, dispatch }) => backspaceSubpagesTitle()(state, dispatch)), true)
    assert.deepEqual(blockTypes(instance), ['paragraph', 'subpages', 'paragraph'])
    assert.equal(instance.state.doc.child(1).textContent, 'Subpages')
    const { $from } = instance.state.selection
    assert.equal($from.parent.textContent, 'Intro')
    assert.equal($from.parentOffset, 'Intro'.length)
  })

  it('takes the list away on Backspace in an empty heading, and jumps up a line', () => {
    const empty = { type: 'subpages', content: [{ type: 'subpagesTitle' }] }
    const instance = editor([paragraph('Intro'), empty, paragraph('After')], 0)
    inTitle(instance, 1)
    assert.equal(instance.commands.command(({ state, dispatch }) => backspaceSubpagesTitle()(state, dispatch)), true)
    assert.deepEqual(blockTypes(instance), ['paragraph', 'paragraph'])
    const { $from } = instance.state.selection
    assert.equal($from.parent.textContent, 'Intro')
    assert.equal($from.parentOffset, 'Intro'.length)
  })

  it('leaves an empty line for an empty heading with nothing above it', () => {
    const instance = editor([{ type: 'subpages', content: [{ type: 'subpagesTitle' }] }, paragraph('After')], 1)
    inTitle(instance, 0)
    instance.commands.command(({ state, dispatch }) => backspaceSubpagesTitle()(state, dispatch))
    assert.deepEqual(blockTypes(instance), ['paragraph', 'paragraph'])
    const { $from } = instance.state.selection
    assert.equal($from.index(0), 0)
    assert.equal($from.parent.content.size, 0)
  })

  it('stays put on Backspace at the start of the heading with nothing above it', () => {
    const instance = editor([subpages(), paragraph('After')], 1)
    inTitle(instance, 0)
    const before = instance.state
    assert.equal(instance.commands.command(({ state, dispatch }) => backspaceSubpagesTitle()(state, dispatch)), true)
    assert.equal(instance.state.doc, before.doc)
    assert.equal(instance.state.selection.from, before.selection.from)
  })

  it('leaves Backspace alone past the start of the heading', () => {
    const instance = editor([paragraph('Intro'), subpages()], 0)
    inTitle(instance, 1, 3)
    assert.equal(instance.commands.command(({ state, dispatch }) => backspaceSubpagesTitle()(state, dispatch)), false)
  })

  it('stays a subpage list when its heading is made a Title, a list or code', () => {
    const instance = editor([subpages(), paragraph()], 1)
    inTitle(instance, 0, 2)
    instance.commands.setNode('heading')
    instance.commands.toggleBulletList()
    instance.commands.toggleCodeBlock()
    instance.commands.setParagraph()
    assert.deepEqual(blockTypes(instance), ['subpages', 'paragraph'])
    assert.equal(instance.state.doc.child(0).textContent, 'Subpages')
  })

  it('keeps its heading to itself when Backspace is pressed on the line after', () => {
    const instance = editor([subpages(), paragraph('After')], 1)
    instance.commands.command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, tr.doc.child(0).nodeSize + 1))
      return true
    })
    instance.commands.first(({ commands }) => [() => commands.joinBackward(), () => commands.selectNodeBackward()])
    assert.deepEqual(blockTypes(instance), ['subpages', 'paragraph'])
    assert.equal(instance.state.doc.child(0).textContent, 'Subpages')
    const { selection } = instance.state
    assert.ok(selection instanceof NodeSelection && selection.node.type.name === 'subpages')
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

  it("is the only item '/sub' finds", () => {
    assert.deepEqual(filterSlashItems('sub').map((item) => item.id), ['subpages'])
  })
})

const schema = getSchema([
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false }),
  Subpages,
  SubpagesTitle,
])

/** A Y.Doc holding a page whose body is the given elements, written straight
 *  into Yjs: an old subpage list is one the schema no longer allows. */
function saved(...body: Y.XmlElement[]) {
  const doc = new Y.Doc()
  const page = schema.node('doc', null, [schema.node('title', null, schema.text('Notes')), schema.node('paragraph')])
  const fragment = doc.getXmlFragment(DOC_FIELD)
  prosemirrorToYXmlFragment(page, fragment)
  fragment.delete(1, 1)
  fragment.insert(1, body)
  return doc
}

function oldList(depth?: number) {
  const element = new Y.XmlElement('subpages')
  if (depth) element.setAttribute('depth', depth as unknown as string)
  return element
}

function titled(text: string) {
  const list = new Y.XmlElement('subpages')
  const title = new Y.XmlElement('subpagesTitle')
  title.insert(0, [new Y.XmlText(text)])
  list.insert(0, [title])
  return list
}

function read(doc: Y.Doc) {
  const node = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(DOC_FIELD), schema)
  node.check()
  return node
}

describe('subpage lists left in old pages', () => {
  it('get their heading back, saying Subpages as the Title it was drawn as, and keep their depth', () => {
    const doc = saved(oldList(2))
    repairSubpageTitles(doc)
    const list = read(doc).child(1)
    assert.equal(list.type.name, 'subpages')
    assert.equal(list.attrs.depth, 2)
    assert.equal(list.textContent, 'Subpages')
    assert.equal(list.child(0).attrs.title, true)
    assert.deepEqual(list.child(0).firstChild!.marks, [])
  })

  it('are found inside other blocks too', () => {
    const doc = saved()
    const fragment = doc.getXmlFragment(DOC_FIELD)
    const item = new Y.XmlElement('listItem')
    item.insert(0, [new Y.XmlElement('paragraph'), oldList()])
    const bullets = new Y.XmlElement('bulletList')
    bullets.insert(0, [item])
    fragment.insert(1, [bullets])
    repairSubpageTitles(doc)
    const page = yXmlFragmentToProseMirrorRootNode(fragment, schema)
    assert.equal(page.child(1).child(0).child(1).textContent, 'Subpages')
  })

  it('survive losing their heading to an old copy of the app, rather than being deleted', () => {
    const list = titled('Projects')
    const doc = saved(list)
    list.delete(0, 1)
    const page = read(doc)
    assert.equal(page.child(1).type.name, 'subpages')
    assert.equal(page.child(1).childCount, 0)
  })

  it('keep only the first heading when two devices each gave one', () => {
    const list = titled('Mine')
    const doc = saved(list)
    const second = new Y.XmlElement('subpagesTitle')
    second.insert(0, [new Y.XmlText('Theirs')])
    list.insert(1, [second])
    repairSubpageTitles(doc)
    assert.equal(read(doc).child(1).textContent, 'Mine')
  })

  it('leave a page whose lists have their headings alone', () => {
    const doc = saved(titled('Projects'))
    let changes = 0
    doc.on('update', () => (changes += 1))
    repairSubpageTitles(doc)
    assert.equal(changes, 0)
    assert.equal(read(doc).child(1).textContent, 'Projects')
  })
})
