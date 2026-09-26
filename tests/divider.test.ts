import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createChainableState, Editor, getExtensionField, type InputRule, type JSONContent } from '@tiptap/core'
import { backspaceAfterDivider, Divider, textPastDivider } from '@/components/editor/extensions/divider'
import { TextSelection } from '@tiptap/pm/state'
import { headlessEditor } from './editor'

/** A headless editor on a page titled 'Notes', the caret at `caret`. */
function editor(caret: number, ...body: JSONContent[]) {
  return headlessEditor(
    { type: 'doc', content: [{ type: 'title', content: [{ type: 'text', text: 'Notes' }] }, ...body] },
    caret,
  )
}

function paragraph(text?: string): JSONContent {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }
}

/** Type the last character of a markdown shortcut, as the input-rule plugin
 *  would hand it to the divider's rule. Falls through to plain typing when no
 *  rule matches, the way the plugin does. */
function typeLast(instance: Editor, text: string) {
  const rules = getExtensionField<() => InputRule[]>(Divider, 'addInputRules', {
    name: 'horizontalRule',
    options: Divider.options,
    storage: {},
    editor: instance,
    type: instance.schema.nodes.horizontalRule,
  })()
  instance.commands.command(({ tr, state }) => {
    const { $from } = tr.selection
    const before = $from.parent.textBetween(0, $from.parentOffset) + text
    for (const rule of rules) {
      const match = before.match(rule.find as RegExp)
      if (!match) continue
      const range = { from: $from.pos - (match[0].length - text.length), to: $from.pos }
      const chainable = createChainableState({ state, transaction: tr })
      const handled = rule.handler({
        state: chainable,
        range,
        match,
        commands: instance.commands,
        chain: () => instance.chain(),
        can: () => instance.can(),
      })
      if (handled !== null) return true
    }
    tr.insertText(text)
    return true
  })
}

/** The body as block types, with any text, and where the caret sits. */
function outline(instance: Editor) {
  const blocks: string[] = []
  instance.state.doc.forEach((node, _offset, index) => {
    if (index > 0) blocks.push(node.textContent ? `${node.type.name}:${node.textContent}` : node.type.name)
  })
  return { blocks, caretIn: instance.state.selection.$from.index(0) - 1 }
}

// Title 'Notes' takes 0..7, so the first body block opens at 7.
const firstBody = 8

describe('divider', () => {
  it("'---' on a line with a blank line below takes the blank line, not a new one", () => {
    const instance = editor(firstBody + 2, paragraph('--'), paragraph(), paragraph('after'))
    typeLast(instance, '-')
    assert.deepEqual(outline(instance), { blocks: ['horizontalRule', 'paragraph', 'paragraph:after'], caretIn: 1 })
  })

  it("'---' with text below still leaves a blank line to type on", () => {
    const instance = editor(firstBody + 2, paragraph('--'), paragraph('after'))
    typeLast(instance, '-')
    assert.deepEqual(outline(instance), { blocks: ['horizontalRule', 'paragraph', 'paragraph:after'], caretIn: 1 })
  })

  it("'---' as the last line still leaves a blank line to type on", () => {
    const instance = editor(firstBody + 2, paragraph('--'))
    typeLast(instance, '-')
    assert.deepEqual(outline(instance), { blocks: ['horizontalRule', 'paragraph'], caretIn: 1 })
  })

  it("'*** ' and '___ ' take the blank line below too", () => {
    for (const typed of ['***', '___']) {
      const instance = editor(firstBody + 3, paragraph(typed), paragraph())
      typeLast(instance, ' ')
      assert.deepEqual(outline(instance), { blocks: ['horizontalRule', 'paragraph'], caretIn: 1 }, typed)
    }
  })

  it('the slash menu on an empty line with a blank line below takes the blank line', () => {
    const instance = editor(firstBody, paragraph(), paragraph(), paragraph('after'))
    instance.chain().setHorizontalRule().run()
    assert.deepEqual(outline(instance), { blocks: ['horizontalRule', 'paragraph', 'paragraph:after'], caretIn: 1 })
  })

  it('the slash menu at the end of a line with a blank line below takes the blank line', () => {
    const instance = editor(firstBody + 4, paragraph('text'), paragraph(), paragraph('after'))
    instance.chain().setHorizontalRule().run()
    assert.deepEqual(outline(instance), {
      blocks: ['paragraph:text', 'horizontalRule', 'paragraph', 'paragraph:after'],
      caretIn: 2,
    })
  })

  it('Backspace at the start of the line under a divider deletes the divider, caret staying put', () => {
    for (const text of [undefined, 'after']) {
      const instance = editor(firstBody + 2, paragraph('before'), { type: 'horizontalRule' }, paragraph(text))
      // 'before' takes 7..15, the rule 15..16, so the line under it opens at 17.
      instance.commands.command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, 17))
        return true
      })
        instance.commands.command(({ state, dispatch }) => backspaceAfterDivider(state, dispatch))
      const blocks = text ? ['paragraph:before', `paragraph:${text}`] : ['paragraph:before', 'paragraph']
      assert.deepEqual(outline(instance), { blocks, caretIn: 1 }, String(text))
      assert.equal(instance.state.selection.empty, true)
      assert.equal(instance.state.selection.$from.parentOffset, 0)
    }
  })

  it('Backspace mid-line under a divider is left to plain Backspace', () => {
    const instance = editor(firstBody, { type: 'horizontalRule' }, paragraph('after'))
    instance.commands.command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, 11))
      return true
    })
    assert.equal(backspaceAfterDivider(instance.state), false)
  })

  it('an arrow off the edge of a line lands on the text past the divider, not on it', () => {
    // 'above' takes 7..14, the rule 14..15, 'below' 15..22.
    const blocks = [paragraph('above'), { type: 'horizontalRule' }, paragraph('below')]
    const down = editor(firstBody + 3, ...blocks)
    assert.equal(textPastDivider(down.state, 1)?.from, 16)
    const up = editor(18, ...blocks)
    assert.equal(textPastDivider(up.state, -1)?.from, 13)
  })

  it('an arrow past two dividers in a row lands on the text past both', () => {
    const instance = editor(firstBody, paragraph('a'), { type: 'horizontalRule' }, { type: 'horizontalRule' }, paragraph())
    // 'a' takes 7..10, the rules 10..11 and 11..12, the blank line opens at 13.
    assert.equal(textPastDivider(instance.state, 1)?.from, 13)
  })

  it('an arrow toward a divider with no text past it goes nowhere', () => {
    const instance = editor(firstBody, paragraph('a'), { type: 'horizontalRule' })
    assert.equal(textPastDivider(instance.state, 1), null)
  })

  it('an arrow with no divider in the way is left alone', () => {
    const instance = editor(firstBody, paragraph('a'), paragraph('b'))
    assert.equal(textPastDivider(instance.state, 1), undefined)
    assert.equal(textPastDivider(instance.state, -1), undefined)
  })
})
