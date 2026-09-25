import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import type { Node, Schema } from '@tiptap/pm/model'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { AccordionKit } from '@/components/editor/extensions/accordion'
import { Callout } from '@/components/editor/extensions/callout'
import { ListItem } from '@/components/editor/extensions/lists'
import { JottrDocument, Title } from '@/components/editor/extensions/title'
import { convertChecklists } from '@/lib/db/checklists'
import { DOC_FIELD } from '@/lib/db/ydoc'

const base = [
  JottrDocument,
  Title,
  StarterKit.configure({ document: false, undoRedo: false, heading: false, blockquote: false, listItem: false }),
  Callout,
  ...AccordionKit,
]

/** The editor as it is now, without checkbox lists. */
const schema = getSchema([...base, ListItem])
/** The editor as it was, with them, to write the documents it left behind. */
const before = getSchema([...base, ListItem, TaskList, TaskItem.configure({ nested: true })])

function paragraph(text: string, marks: string[] = []) {
  return before.node('paragraph', null, [before.text(text, marks.map((mark) => before.mark(mark)))])
}

function tasks(...items: [boolean, Node[]][]) {
  return before.node('taskList', null, items.map(([checked, content]) => before.node('taskItem', { checked }, content)))
}

/** A Y.Doc holding a page with the given body blocks, as it was saved. */
function saved(...body: Node[]) {
  const doc = new Y.Doc()
  const page = before.node('doc', null, [before.node('title', null, before.text('Notes')), ...body])
  prosemirrorToYXmlFragment(page, doc.getXmlFragment(DOC_FIELD))
  return doc
}

function read(doc: Y.Doc, into: Schema = schema) {
  const node = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(DOC_FIELD), into)
  node.check()
  return node
}

describe('checkbox lists left in old pages', () => {
  it('become bullet lists, keeping their text, marks and nesting', () => {
    const doc = saved(
      tasks(
        [true, [paragraph('done', ['bold']), tasks([false, [paragraph('sub')]])]],
        [false, [paragraph('open')]],
      ),
    )
    convertChecklists(doc)
    const page = read(doc)
    const list = page.child(1)
    assert.equal(list.type.name, 'bulletList')
    assert.deepEqual(list.content.content.map((item) => [item.type.name, Object.keys(item.attrs)]), [
      ['listItem', []],
      ['listItem', []],
    ])
    const first = list.child(0)
    assert.equal(first.child(0).textContent, 'done')
    assert.deepEqual(first.child(0).firstChild!.marks.map((mark) => mark.type.name), ['bold'])
    assert.equal(first.child(1).type.name, 'bulletList')
    assert.equal(first.child(1).textContent, 'sub')
    assert.equal(list.child(1).textContent, 'open')
  })

  it('are found inside other blocks too', () => {
    const doc = saved(
      before.node('callout', null, [tasks([false, [paragraph('in a callout')]])]),
      before.node('bulletList', null, [
        before.node('listItem', null, [paragraph('parent'), tasks([true, [paragraph('nested')]])]),
      ]),
    )
    convertChecklists(doc)
    const page = read(doc)
    assert.equal(page.child(1).child(0).type.name, 'bulletList')
    assert.equal(page.child(1).textContent, 'in a callout')
    assert.equal(page.child(2).child(0).child(1).type.name, 'bulletList')
    assert.equal(page.child(2).child(0).child(1).textContent, 'nested')
  })

  it('leaves a page with none untouched, and converts only once', () => {
    const plain = saved(paragraph('nothing to do'))
    const doc = saved(tasks([false, [paragraph('one')]]))
    convertChecklists(doc)

    let updates = 0
    for (const each of [plain, doc]) each.on('update', () => (updates += 1))
    convertChecklists(plain)
    convertChecklists(doc)
    assert.equal(updates, 0)
  })

  it('shows up in a copy of the document elsewhere, as a synced edit would', () => {
    const doc = saved(tasks([false, [paragraph('one')]]))
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    convertChecklists(doc)
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)))
    assert.ok(read(other).eq(read(doc)))
    assert.equal(read(other).child(1).type.name, 'bulletList')
  })
})
