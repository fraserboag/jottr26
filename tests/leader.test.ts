import assert from 'node:assert/strict'
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads'
import { after, describe, it } from 'node:test'
import { FakeServer, installBrowserGlobals } from './harness'

installBrowserGlobals()

/** Just enough of the Web Locks API to elect a leader: one holder per name, a
 *  queue behind it, `signal` to leave the queue and `steal` to take over. */
class FakeLocks {
  private held = new Map<string, { reject: (error: Error) => void }>()
  private queue = new Map<string, Array<() => void>>()

  request(
    name: string,
    options: { signal?: AbortSignal; steal?: boolean },
    callback: () => Promise<void>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        let settled = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          if (this.held.get(name) === holder) {
            this.held.delete(name)
            this.queue.get(name)?.shift()?.()
          }
          if (error) reject(error)
          else resolve()
        }
        const holder = { reject: (error: Error) => finish(error) }
        this.held.set(name, holder)
        callback().then(() => finish(), finish)
      }

      if (options.steal) {
        this.held.get(name)?.reject(new Error('AbortError'))
        this.held.delete(name)
        grant()
      } else if (!this.held.has(name)) {
        grant()
      } else {
        const waiting = this.queue.get(name) ?? []
        waiting.push(grant)
        this.queue.set(name, waiting)
        options.signal?.addEventListener('abort', () => {
          const index = waiting.indexOf(grant)
          if (index >= 0) waiting.splice(index, 1)
          reject(new Error('AbortError'))
        })
      }
    })
  }
}

const g = globalThis as unknown as Record<string, unknown>
;(g.navigator as Record<string, unknown>).locks = new FakeLocks()
g.BroadcastChannel = NodeBroadcastChannel
const visibility = new EventTarget()
g.document = Object.assign(visibility, {
  visibilityState: 'visible',
  addEventListener: visibility.addEventListener.bind(visibility),
  removeEventListener: visibility.removeEventListener.bind(visibility),
})

const { closeDatabase } = await import('@/lib/db/dexie')
const { SyncEngine } = await import('@/lib/sync/engine')

const server = new FakeServer()
const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

type Engine = InstanceType<typeof SyncEngine>
const leading = (engine: Engine) => (engine as unknown as { isLeader: boolean }).isLeader

/** Two tabs of the app open for the same account — or, on a phone, the tab
 *  in use and an older one the browser has frozen in the background. */
describe('more than one tab', () => {
  const first = new SyncEngine(server.client(), 'tabs')
  const second = new SyncEngine(server.client(), 'tabs')

  after(() => {
    first.stop()
    second.stop()
    closeDatabase()
  })

  it('does not leave the tab that is not syncing stuck on "syncing"', async () => {
    await first.start()
    await wait()
    ;(document as unknown as { visibilityState: string }).visibilityState = 'hidden'
    await second.start()
    await wait()

    assert.equal(leading(first), true)
    assert.equal(leading(second), false)
    assert.equal(first.getStatus().phase, 'synced')
    assert.equal(second.getStatus().phase, 'synced', 'the waiting tab shows what the leader reports')
  })

  it('hands syncing to the tab that is brought to the front', async () => {
    ;(document as unknown as { visibilityState: string }).visibilityState = 'visible'
    const before = server.counts.select
    // Only the second tab is "being looked at"; dispatching reaches both
    // engines, but the leader just syncs again.
    visibility.dispatchEvent(new Event('visibilitychange'))
    await wait()

    assert.equal(leading(second), true, 'the tab in front took the lock')
    assert.equal(leading(first), false, 'and the other tab queued up behind it')
    assert.ok(server.counts.select > before, 'and synced with it')
    assert.equal(second.getStatus().phase, 'synced')
  })
})
