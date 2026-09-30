import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import { afterPaint, idleAfterPaint } from '../lib/util/idle'

function browser(t: TestContext, supportsIdle = true) {
  let id = 0
  const frames = new Map<number, () => void>()
  const idle = new Map<number, () => void>()
  const timers = new Map<number, () => void>()
  const delays: number[] = []
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame: (callback: () => void) => { frames.set(++id, callback); return id },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      ...(supportsIdle ? {
        requestIdleCallback: (callback: () => void) => { idle.set(++id, callback); return id },
        cancelIdleCallback: (id: number) => idle.delete(id),
      } : {}),
      setTimeout: (callback: () => void, delay: number) => {
        delays.push(delay)
        timers.set(++id, callback)
        return id
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  function flush(queue: Map<number, () => void>) {
    const callbacks = [...queue.values()]
    queue.clear()
    callbacks.forEach((callback) => callback())
  }
  return {
    frame: () => flush(frames),
    runIdle: () => flush(idle),
    runTimers: () => flush(timers),
    frames, idle, timers, delays,
  }
}

describe('optional editor warmup scheduling', () => {
  it('gives the list a paint opportunity and then waits for idle', (t) => {
    const clock = browser(t)
    let ran = false
    idleAfterPaint(() => { ran = true })
    clock.frame()
    clock.runIdle()
    assert.equal(ran, false)
    clock.frame()
    assert.equal(ran, false)
    assert.equal(clock.idle.size, 1)
    assert.equal(clock.timers.size, 0)
    clock.runIdle()
    assert.equal(ran, true)
  })

  it('cancels work when a note opens before either frame or the idle callback', (t) => {
    const clock = browser(t)
    let runs = 0
    for (const frames of [0, 1, 2]) {
      const cancel = idleAfterPaint(() => { runs++ })
      for (let i = 0; i < frames; i++) clock.frame()
      cancel()
      clock.frame()
      clock.frame()
      clock.runIdle()
      assert.equal(runs, 0)
      assert.equal(clock.frames.size + clock.idle.size + clock.timers.size, 0)
    }
  })

  it('delays warmup after paint without idle APIs and cancels that fallback', (t) => {
    const clock = browser(t, false)
    let runs = 0
    const cancel = idleAfterPaint(() => { runs++ })
    clock.frame()
    clock.frame()
    assert.equal(runs, 0)
    assert.deepEqual(clock.delays, [500])
    cancel()
    clock.runTimers()
    assert.equal(runs, 0)

    idleAfterPaint(() => { runs++ })
    clock.frame()
    clock.frame()
    clock.runTimers()
    assert.equal(runs, 1)
  })

  it('cancels pending paint measurements on unmount', (t) => {
    const clock = browser(t)
    let ran = false
    const cancel = afterPaint(() => { ran = true })
    clock.frame()
    cancel()
    clock.frame()
    assert.equal(ran, false)
  })
})
