import assert from 'node:assert/strict'
import { Editor, getSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import type { Node } from '@tiptap/pm/model'
import { pageExtensions } from '@/components/editor/extensions/page'

/** The schema a page is written in: the editor's own extension list, the one
 *  it installs, so a test can never pass against a schema the app has left
 *  behind. */
export const pageSchema = getSchema(pageExtensions())

export function paragraph(text?: string) {
  return pageSchema.node('paragraph', null, text ? [pageSchema.text(text)] : [])
}

/** A page titled 'Notes' holding the given body blocks, with the caret in the
 *  last text position — which is where someone typing has just arrived. */
export function page(...body: Node[]) {
  const doc = pageSchema.node('doc', null, [pageSchema.node('title', null, pageSchema.text('Notes')), ...body])
  const state = EditorState.create({ doc, schema: pageSchema })
  return state.apply(state.tr.setSelection(TextSelection.near(doc.resolve(doc.content.size), -1)))
}

/** The same document with the caret parked at an exact position. */
export function caretAt(state: EditorState, pos: number) {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

/** Run a ProseMirror command the way the editor's chain does. */
export function run(state: EditorState, command: Command) {
  let next = state
  let transaction: Transaction | null = null
  const applied = command(state, (tr) => {
    transaction = tr
    next = state.apply(tr)
  })
  return { state: next, applied, tr: transaction as Transaction | null }
}

/** The names of the document's top-level blocks, title included. */
export function outline(state: EditorState) {
  return state.doc.children.map((node) => node.type.name)
}

/** The position of the first textblock of the given type, plus an offset. */
export function inside(state: EditorState, type: string, offset = 0) {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos + 1 + offset
    return found < 0
  })
  assert.notEqual(found, -1, `no ${type} in the document`)
  return found
}

/** The first table in the document, its map, and where its content starts. */
export function locate(state: EditorState) {
  let pos = -1
  let node: Node | null = null
  state.doc.descendants((candidate, at) => {
    if (node || candidate.type.name !== 'table') return !node
    pos = at
    node = candidate
    return false
  })
  assert.ok(node, 'no table in the document')
  return { node: node as Node, map: TableMap.get(node), start: pos + 1 }
}

/** The position before a cell of the first table. */
export function cellAt(state: EditorState, row: number, col: number) {
  const { map, start } = locate(state)
  return start + map.map[row * map.width + col]
}

/** The caret at the start of a cell's first line. */
export function caretIn(state: EditorState, row = 0, col = 0) {
  return caretAt(state, cellAt(state, row, col) + 2)
}

/** A headless editor on `content`, with the caret at `caret`. For what only a
 *  real Editor does: its keymaps, input rules and split behaviour. */
export function headlessEditor(content: JSONContent, caret: number, extensions: AnyExtension[] = pageExtensions()) {
  const instance = new Editor({ element: null, extensions, content })
  instance.commands.command(({ tr }) => {
    tr.setSelection(TextSelection.create(tr.doc, caret))
    return true
  })
  return instance
}
