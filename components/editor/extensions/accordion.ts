import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import type { Fragment, Node as PMNode, ResolvedPos, Schema } from '@tiptap/pm/model'
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import { nestedList, newFirstItem } from './lists'

/** An accordion: a heading line that owns a box beneath it, which folds away.
 *
 *  The heading is an ordinary line of body text, formatted however it is
 *  written — plain, bold, italic — so a line can be turned into an accordion,
 *  or back, without it looking like a different kind of block. What it adds is
 *  the box below and the chevron that opens and shuts it. It can stand on the
 *  page or be the first line of a list item.
 *
 *  One attribute, `open`, and it lives in the document. That makes a folded
 *  section stay folded across reloads and page switches, and it means folding
 *  one on a phone folds it on the laptop too: it rides the CRDT like any other
 *  edit. It is kept off the undo stack, since opening a box is not something
 *  anyone expects Cmd-Z to take back. */

export const ACCORDION = 'accordion'
export const ACCORDION_TITLE = 'accordionTitle'
export const ACCORDION_BODY = 'accordionBody'

/** A fresh, open accordion whose heading holds the given inline content, over
 *  a box with one empty line in it. */
function build(schema: Schema, inline: Fragment) {
  const { accordion, accordionTitle, accordionBody, paragraph } = schema.nodes
  return accordion.create(null, [accordionTitle.create(null, inline), accordionBody.create(null, paragraph.create())])
}

/** Turn the paragraph the caret is in into an accordion, keeping its text as
 *  the heading and the caret where it was in that text. */
export function makeAccordion(): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const paragraph = $from.parent
    if (paragraph.type.name !== 'paragraph' || !$from.sameParent($to)) return false

    const start = $from.before()
    const index = $from.index(-1)
    const node = build(state.schema, paragraph.content)
    if (!$from.node(-1).canReplaceWith(index, index + 1, node.type)) return false

    if (dispatch) {
      const tr = state.tr.replaceWith(start, $from.after(), node)
      // Into the heading, two levels down: accordion, then its title.
      tr.setSelection(TextSelection.create(tr.doc, start + 2 + $from.parentOffset))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** The accordion around the selection, if there is one, with its position. */
function findAccordion($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === ACCORDION) return { node, pos: $pos.before(depth) }
  }
  return null
}

/** Put an accordion back to plain blocks: the heading becomes a paragraph and
 *  whatever the box held follows it on the page. A box holding nothing but an
 *  empty line leaves nothing behind. */
export function unwrapAccordion(): Command {
  return (state, dispatch) => {
    const found = findAccordion(state.selection.$from)
    if (!found) return false

    if (dispatch) {
      const { node, pos } = found
      const [title, body] = [node.child(0), node.child(1)]
      const blocks: PMNode[] = [state.schema.nodes.paragraph.create(null, title.content)]
      const onlyBlank = body.childCount === 1 && body.firstChild!.type.name === 'paragraph' && body.firstChild!.content.size === 0
      if (!onlyBlank) body.forEach((child) => blocks.push(child))

      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, blocks)
      tr.setSelection(TextSelection.create(tr.doc, pos + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

const LIST_ITEMS = ['listItem', 'taskItem']

/** Onto a new line straight after an accordion. When the accordion is the
 *  first line of a list item, that is what Enter makes at the end of an
 *  item's first line: a new first item of the ones nested under it, or the
 *  next item of the list when there are none. Anywhere else it is a new line
 *  below. False where no line can go. */
function newLineAfter(tr: Transaction, after: number) {
  const $after = tr.doc.resolve(after)
  const parent = $after.parent
  const paragraph = tr.doc.type.schema.nodes.paragraph

  if ($after.index() === 1 && nestedList(parent)) {
    newFirstItem(tr, after)
    return true
  }

  if (LIST_ITEMS.includes(parent.type.name) && $after.index() === 1) {
    const attrs = parent.type.name === 'taskItem' ? { ...parent.attrs, checked: false } : parent.attrs
    tr.insert(after, paragraph.create()).split(after, 1, [{ type: parent.type, attrs }])
    // Past the item's close, the new item's open and the paragraph's.
    tr.setSelection(TextSelection.create(tr.doc, after + 3))
    return true
  }

  if (!parent.canReplaceWith($after.index(), $after.index(), paragraph)) return false
  tr.insert(after, paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  return true
}

/** Enter, in a heading: down into the box, onto a fresh line of its own.
 *
 *  The same thing Enter does in the page title, for the same reason — the
 *  heading names what comes next, so Enter goes to write it. A folded box is
 *  stepped over instead: its contents are put away, so Enter is a new line
 *  below it, as it would be after any other line — or the next item, in a
 *  list. */
export function enterAccordionBody(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.parent.type.name !== ACCORDION_TITLE) return false

    const accordion = $from.node(-1)
    if (!accordion.attrs.open) {
      const tr = state.tr
      if (!newLineAfter(tr, $from.after(-1))) return false
      if (dispatch) dispatch(tr.scrollIntoView())
      return true
    }

    if (dispatch) {
      const tr = state.tr
      // Past the heading and into the box.
      const bodyStart = $from.after() + 1
      const first = accordion.child(1).firstChild
      if (first?.type.name === 'paragraph' && first.content.size === 0) {
        tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1))
      } else {
        tr.insert(bodyStart, state.schema.nodes.paragraph.create())
        tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1))
      }
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Enter, on an empty last line of the box: out of the accordion, onto a new
 *  line below it, or the next item when the accordion heads a list item.
 *
 *  Everywhere else in the box Enter is a new line, as it is on the page. The
 *  blank last line is the way out, as it is at the end of a list. The line is
 *  taken with you unless it is the box's only one, which has to stay. */
export function leaveAccordion(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.depth < 3 || $from.parent.type.name !== 'paragraph') return false
    if ($from.parent.content.size > 0) return false
    const body = $from.node(-1)
    if (body.type.name !== ACCORDION_BODY || $from.index(-1) !== body.childCount - 1) return false

    const tr = state.tr
    if (body.childCount > 1) tr.delete($from.before(), $from.after())
    if (!newLineAfter(tr, tr.mapping.map($from.after(-2)))) return false
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  }
}

/** Backspace, at the very start of a heading: the accordion goes, and what was
 *  in it stays — the heading as a line of its own, the box's lines under it.
 *  The way back out of one opened with '>'. */
export function backspaceAccordion(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.parent.type.name !== ACCORDION_TITLE || $from.parentOffset > 0) return false
    return unwrapAccordion()(state, dispatch)
  }
}

/** Backspace, at the very start of the box: up to the end of the heading, so
 *  the next press carries on deleting there, the way it would if the heading
 *  were the line above.
 *
 *  The line you were on stays in the box, since pulling it into the heading
 *  would make body text into heading text. An empty one goes, unless it is
 *  the box's only line, which has to stay. */
export function backspaceIntoHeading(): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.parentOffset > 0 || $from.depth < 3 || $from.parent.type.name !== 'paragraph') return false
    const body = $from.node(-1)
    if (body.type.name !== ACCORDION_BODY || $from.index(-1) !== 0) return false

    if (dispatch) {
      // The body starts straight after the heading closes.
      const titleEnd = $from.before(-1) - 1
      const tr = state.tr
      if ($from.parent.content.size === 0 && body.childCount > 1) tr.delete($from.before(), $from.after())
      tr.setSelection(TextSelection.create(tr.doc, titleEnd))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

/** Open or fold the accordion at a position. Folding one with the caret inside
 *  its box brings the caret up to the end of the heading, rather than leaving
 *  it somewhere nobody can see. */
export function setAccordionOpen(pos: number, open: boolean): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (node?.type.name !== ACCORDION) return false
    if (dispatch) {
      const tr = state.tr.setNodeAttribute(pos, 'open', open).setMeta('addToHistory', false)
      const titleEnd = pos + node.child(0).nodeSize
      const { from, to } = state.selection
      if (!open && to > titleEnd + 1 && from < pos + node.nodeSize) {
        tr.setSelection(TextSelection.create(tr.doc, titleEnd))
      }
      dispatch(tr)
    }
    return true
  }
}

/** A position inside a folded box, if the selection has landed in one. */
function hiddenAccordion(state: EditorState, $pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name !== ACCORDION_BODY) continue
    const accordion = $pos.node(depth - 1)
    if (!accordion.attrs.open) return { accordion, pos: $pos.before(depth - 1) }
  }
  return null
}

/** Arrow keys walk the document, and the document still holds a folded box's
 *  lines. Where the caret would land in one, it goes to the heading when it
 *  came from below and past the accordion when it came from above. */
const skipFolded = new Plugin({
  key: new PluginKey('accordionSkipFolded'),
  appendTransaction(transactions, oldState, state) {
    if (!transactions.some((tr) => tr.selectionSet)) return null
    const { selection } = state
    const hidden = hiddenAccordion(state, selection.$head)
    if (!hidden) return null

    const { accordion, pos } = hidden
    const titleEnd = pos + accordion.child(0).nodeSize
    const fromAbove = oldState.selection.head <= pos
    if (!fromAbove) return state.tr.setSelection(TextSelection.create(state.doc, titleEnd))

    const end = pos + accordion.nodeSize
    const next = Selection.findFrom(state.doc.resolve(end), 1, true)
    // Nothing further down to go to: stay on the heading.
    return state.tr.setSelection(next ?? TextSelection.create(state.doc, titleEnd))
  },
})

/** The accordion's frame: a chevron to open and fold it, and the heading and
 *  box inside, which ProseMirror draws. */
class AccordionView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private button: HTMLButtonElement

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.dataset.type = ACCORDION

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.contentEditable = 'false'
    this.button.className = 'accordion-toggle'
    this.button.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    // Mouse down would move the caret to wherever the button sits first.
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', (event) => {
      event.preventDefault()
      const pos = this.getPos()
      if (pos === undefined) return
      setAccordionOpen(pos, !this.node.attrs.open)(this.view.state, this.view.dispatch)
    })

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'accordion-content'

    this.dom.append(this.button, this.contentDOM)
    this.render()
  }

  private render() {
    const open = Boolean(this.node.attrs.open)
    this.dom.dataset.open = String(open)
    this.button.setAttribute('aria-expanded', String(open))
    this.button.setAttribute('aria-label', open ? 'Fold section' : 'Open section')
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  /** The button's attributes change under ProseMirror's nose; nothing in it
   *  is document content. */
  ignoreMutation(mutation: ViewMutationRecord) {
    if (mutation.type === 'selection') return false
    return !this.contentDOM.contains(mutation.target)
  }

  stopEvent(event: Event) {
    return event.target instanceof globalThis.Node && this.button.contains(event.target)
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    accordion: {
      /** Turn the current paragraph into an accordion, or an accordion back
       *  into plain blocks. */
      toggleAccordion: () => ReturnType
    }
  }
}

export const AccordionTitle = Node.create({
  name: ACCORDION_TITLE,
  content: 'inline*',
  defining: true,
  // Backspace at the start of the box, or Delete at the end of the heading,
  // would otherwise join the two and pull the accordion apart.
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="accordionTitle"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': ACCORDION_TITLE }), 0]
  },
})

export const AccordionBody = Node.create({
  name: ACCORDION_BODY,
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="accordionBody"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': ACCORDION_BODY }), 0]
  },
})

export const Accordion = Node.create({
  name: ACCORDION,
  group: 'block',
  content: `${ACCORDION_TITLE} ${ACCORDION_BODY}`,
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-open') !== 'false',
        renderHTML: (attributes) => ({ 'data-open': String(attributes.open) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="accordion"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': ACCORDION }), 0]
  },

  addNodeView() {
    return ({ node, view, getPos }) => new AccordionView(node, view, getPos)
  },

  addCommands() {
    return {
      toggleAccordion:
        () =>
        ({ state, dispatch }) =>
          findAccordion(state.selection.$from)
            ? unwrapAccordion()(state, dispatch)
            : makeAccordion()(state, dispatch),
    }
  },

  addInputRules() {
    return [
      // '>' then a space, at the start of a line.
      new InputRule({
        find: /^>\s$/,
        handler: ({ state, range, chain }) => {
          // Somewhere an accordion cannot go, the '> ' stays as typed.
          if (!makeAccordion()(state)) return null
          chain()
            .deleteRange(range)
            .command(({ state: next, dispatch }) => makeAccordion()(next, dispatch))
            .run()
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    const run = (command: Command) => () =>
      this.editor.commands.command(({ state, dispatch }) => command(state, dispatch))
    const enter = enterAccordionBody()
    const leave = leaveAccordion()
    const unwrap = backspaceAccordion()
    const intoHeading = backspaceIntoHeading()
    return {
      Enter: run((state, dispatch) => enter(state, dispatch) || leave(state, dispatch)),
      Backspace: run((state, dispatch) => unwrap(state, dispatch) || intoHeading(state, dispatch)),
    }
  },

  addProseMirrorPlugins() {
    return [skipFolded]
  },
})

export const AccordionKit = [Accordion, AccordionTitle, AccordionBody]
