import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listenForMouseHistory } from '../lib/util/mouseHistory'

function browser(vendor = 'Apple Computer, Inc.') {
  const target = new EventTarget()
  const steps: number[] = []
  Object.assign(target, {
    navigator: { vendor },
    history: { go: (step: number) => steps.push(step) },
  })
  const cleanup = listenForMouseHistory(target as unknown as Window)
  function mouse(type: string, button: number, buttons = 0) {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { button, buttons })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  return { target, steps, mouse, cleanup }
}

describe('Safari mouse history navigation', () => {
  it('navigates once per side-button press with both WebKit event formats', () => {
    const { mouse, steps } = browser()
    for (const [button, buttons, step] of [[3, 8, -1], [4, 16, 1], [1, 8, -1], [1, 16, 1]]) {
      const before = steps.length
      assert.equal(mouse('mousedown', button, buttons), true)
      assert.equal(mouse('mouseup', button), true)
      assert.equal(mouse('auxclick', button), true)
      assert.equal(steps.length, before + 1)
      assert.equal(steps.at(-1), step)
    }
  })

  it('leaves ordinary clicks and middle clicks with a side button held alone', () => {
    const { mouse, steps } = browser()
    mouse('mousedown', 1, 8)
    mouse('mouseup', 1)
    for (const [button, buttons] of [[0, 1], [2, 2], [1, 4], [1, 12], [1, 20], [0, 9]]) {
      assert.equal(mouse('mousedown', button, buttons), false)
      assert.equal(mouse('mouseup', button), false)
      assert.equal(mouse('auxclick', button), false)
    }
    assert.deepEqual(steps, [-1])
  })

  it('resets on blur and removes listeners on cleanup', () => {
    const { target, mouse, steps, cleanup } = browser()
    mouse('mousedown', 1, 16)
    target.dispatchEvent(new Event('blur'))
    assert.equal(mouse('mouseup', 1), false)
    cleanup?.()
    assert.equal(mouse('mousedown', 3, 8), false)
    assert.equal(mouse('mouseup', 3), false)
    assert.equal(mouse('auxclick', 3), false)
    assert.deepEqual(steps, [1])
  })

  it('leaves native mouse navigation to other browsers', () => {
    const { mouse, steps, cleanup } = browser('Google Inc.')
    assert.equal(cleanup, undefined)
    assert.equal(mouse('mousedown', 3, 8), false)
    assert.equal(mouse('mouseup', 3), false)
    assert.equal(mouse('mousedown', 4, 16), false)
    assert.deepEqual(steps, [])
  })
})
