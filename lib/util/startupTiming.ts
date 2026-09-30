/** These entries contain timing labels only, never account or note data. They
 * live in this document's Performance timeline and are not sent anywhere. */
const PREFIX = 'jottr:'

// Runs in the workspace HTML before its JavaScript has hydrated. Deliberately
// tiny, so measuring startup adds no external script or request to startup.
export const STARTUP_TIMING_SCRIPT = `try{performance.mark('${PREFIX}document-start')}catch(e){}`

type Milestone = 'hydrated' | 'session-ready' | 'pages-ready' | 'workspace-painted' |
  'editor-load-start' | 'editor-code-ready' | 'document-load-start' | 'document-ready' | 'editor-painted'

const PHASES: Partial<Record<Milestone, [string, string]>> = {
  hydrated: ['document-start', 'hydration'],
  'session-ready': ['hydrated', 'session'],
  'pages-ready': ['session-ready', 'local-pages'],
  'workspace-painted': ['pages-ready', 'workspace-paint'],
  'editor-code-ready': ['editor-load-start', 'editor-code'],
  'document-ready': ['document-load-start', 'local-document'],
  'editor-painted': ['document-ready', 'editor-render'],
}

/** Record each launch milestone once. Re-renders, StrictMode and subsequent
 * page navigation must not overwrite the original timings or grow the buffer.
 * Diagnostics must never prevent the app from opening if an API is missing. */
export function markStartup(milestone: Milestone) {
  if (typeof window === 'undefined') return
  try {
    const perf = window.performance
    const end = PREFIX + milestone
    if (perf.getEntriesByName(end, 'mark').length) return
    perf.mark(end)
    const phase = PHASES[milestone]
    if (phase && perf.getEntriesByName(PREFIX + phase[0], 'mark').length) {
      perf.measure(PREFIX + phase[1], PREFIX + phase[0], end)
    }
    if (milestone === 'workspace-painted') {
      perf.measure(PREFIX + 'startup', { start: 0, end })
      const navigation = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (navigation?.responseStart) {
        perf.measure(PREFIX + 'shell-response', { start: 0, end: navigation.responseStart })
      }
    }
  } catch {
    // Timing APIs are optional. Notes and editing never depend on them.
  }
}
