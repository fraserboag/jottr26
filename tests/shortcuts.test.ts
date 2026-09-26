import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getExtensionField, type KeyboardShortcutCommand } from '@tiptap/core'
import { headlessEditor } from './editor'

const TIPTAP_OWN = new Set(['keymap', 'listKeymap'])

describe('keyboard shortcuts', () => {
  it('dispatch nothing for a key none of them takes', () => {
    const title = { type: 'title', content: [{ type: 'text', text: 'N' }] }
    const line = { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
    // Mid-word, where every Backspace binding in the page's extensions declines.
    const instance = headlessEditor({ type: 'doc', content: [title, line] }, 6)
    let dispatched = 0
    instance.on('transaction', () => {
      dispatched += 1
    })

    let bindings = 0
    for (const extension of instance.extensionManager.extensions) {
      if (extension.type === 'mark') continue
      const shortcuts = getExtensionField<() => Record<string, KeyboardShortcutCommand>>(
        extension,
        'addKeyboardShortcuts',
        {
          name: extension.name,
          options: extension.options,
          storage: extension.storage,
          editor: instance,
          type: instance.schema.nodes[extension.name],
        },
      )
      const backspace = shortcuts?.().Backspace
      // Tiptap's own keymaps run through its command chain, which dispatches
      // whatever they return. Only this app's bindings are in question here.
      if (!backspace || TIPTAP_OWN.has(extension.name)) continue
      assert.equal(backspace({ editor: instance }), false, extension.name)
      bindings += 1
    }

    assert.ok(bindings > 3, 'several extensions bind Backspace')
    assert.equal(dispatched, 0)
  })
})
