import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { syncPageWorkspace } from '@/lib/util/route'

describe('page space routing', () => {
  it('replaces stale space hints on cross-space links and history entries', () => {
    const browser = new EventTarget()
    let replacements = 0
    const location = { pathname: '/app', search: '?p=personal-note&w=work' }
    const fakeWindow = Object.assign(browser, {
      location,
      history: { replaceState: (_state: unknown, _unused: string, url: string) => {
        location.search = new URL(url, 'https://jottr.test').search
        replacements++
      } },
    })
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
    try {
      syncPageWorkspace('personal-note', 'personal')
      const trash = new URLSearchParams(location.search)
      trash.delete('p')
      trash.set('trash', '')
      assert.equal(trash.get('w'), 'personal', 'leaving the note retains its owning space')
      syncPageWorkspace('personal-note', 'personal')
      assert.equal(replacements, 1, 'already canonical routes do not navigate again')
      location.search = '?p=work-note&w=personal'
      syncPageWorkspace('personal-note', 'personal')
      assert.equal(replacements, 1, 'a stale page effect cannot rewrite a newer navigation')
      syncPageWorkspace('work-note', 'work')
      assert.equal(new URLSearchParams(location.search).get('w'), 'work')
    } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })
})
