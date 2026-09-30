import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { describe, it, type TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'
import { markStartup, STARTUP_TIMING_SCRIPT } from '../lib/util/startupTiming'

function browser(t: TestContext, perf: unknown = performance) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { performance: perf } })
  t.after(() => {
    performance.clearMarks()
    performance.clearMeasures()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
}

describe('local startup diagnostics', () => {
  it('records launch stages once and excludes user waiting from document loading', (t) => {
    browser(t)
    runInNewContext(STARTUP_TIMING_SCRIPT, { performance })
    for (const milestone of ['hydrated', 'session-ready', 'pages-ready', 'workspace-painted'] as const) {
      markStartup(milestone)
      markStartup(milestone)
    }
    assert.deepEqual(performance.getEntriesByType('measure').map((entry) => entry.name), [
      'jottr:startup', 'jottr:hydration', 'jottr:session', 'jottr:local-pages', 'jottr:workspace-paint',
    ])
    assert.equal(performance.getEntriesByName('jottr:workspace-painted', 'mark').length, 1)

    // Warmup can finish long before the user opens a note. That gap should
    // never be reported as time spent reading its document from IndexedDB.
    performance.mark('jottr:editor-load-start', { startTime: 0 })
    markStartup('editor-code-ready')
    markStartup('document-load-start')
    markStartup('document-ready')
    markStartup('editor-painted')
    const document = performance.getEntriesByName('jottr:local-document', 'measure')[0]
    assert.equal(document.startTime, performance.getEntriesByName('jottr:document-load-start', 'mark')[0].startTime)
    assert.ok(document.startTime > performance.getEntriesByName('jottr:editor-code-ready', 'mark')[0].startTime)
    assert.equal(performance.getEntriesByName('jottr:editor-render', 'measure').length, 1)
  })

  it('includes time to the first shell byte when navigation timing is available', (t) => {
    browser(t, {
      mark: performance.mark.bind(performance),
      measure: performance.measure.bind(performance),
      getEntriesByName: performance.getEntriesByName.bind(performance),
      getEntriesByType: () => [{ responseStart: 12 }],
    })
    markStartup('workspace-painted')
    assert.equal(performance.getEntriesByName('jottr:shell-response', 'measure')[0].duration, 12)
  })

  it('does not interrupt the app when timing APIs are unavailable or blocked', (t) => {
    browser(t, null)
    assert.doesNotThrow(() => markStartup('hydrated'))
    assert.doesNotThrow(() => runInNewContext(STARTUP_TIMING_SCRIPT, {
      performance: { mark() { throw new Error('blocked') } },
    }))
    Reflect.deleteProperty(globalThis, 'window')
    assert.doesNotThrow(() => markStartup('session-ready'))
  })
})
