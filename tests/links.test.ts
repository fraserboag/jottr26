import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveLink } from '@/lib/util/links'

/** The workspace URL a link would be clicked on. */
const HERE = 'https://jottr.app/app?p=home'

describe('resolveLink', () => {
  it('follows a link to another page in place', () => {
    assert.deepEqual(resolveLink('https://jottr.app/app?p=abc123', HERE), {
      kind: 'page',
      pageId: 'abc123',
    })
  })

  it('follows a relative page link in place', () => {
    assert.deepEqual(resolveLink('/app?p=abc123', HERE), { kind: 'page', pageId: 'abc123' })
  })

  it('reads the page id past other query parameters', () => {
    assert.deepEqual(resolveLink('/app?new=1&p=abc123#notes', HERE), {
      kind: 'page',
      pageId: 'abc123',
    })
  })

  it('treats the same path on another origin as outbound', () => {
    // Someone else's Jottr, or the deployed app opened from a dev server. It
    // is a different workspace, and this one cannot render its pages.
    assert.deepEqual(resolveLink('https://notes.example.com/app?p=abc123', HERE), {
      kind: 'external',
      href: 'https://notes.example.com/app?p=abc123',
    })
  })

  it('treats other pages of this app as outbound', () => {
    assert.deepEqual(resolveLink('/login', HERE), {
      kind: 'external',
      href: 'https://jottr.app/login',
    })
    assert.deepEqual(resolveLink('/app', HERE), {
      kind: 'external',
      href: 'https://jottr.app/app',
    })
  })

  it('opens ordinary web and mail links outward', () => {
    assert.deepEqual(resolveLink('https://example.com/docs', HERE), {
      kind: 'external',
      href: 'https://example.com/docs',
    })
    assert.deepEqual(resolveLink('mailto:someone@example.com', HERE), {
      kind: 'external',
      href: 'mailto:someone@example.com',
    })
  })

  it('refuses a script url and anything unparseable', () => {
    // A page's marks arrive from other devices, so this is reachable without
    // anyone typing it into the link field on this one.
    assert.equal(resolveLink('javascript:alert(1)', HERE), null)
    assert.equal(resolveLink('file:///etc/passwd', HERE), null)
    assert.equal(resolveLink('', HERE), null)
    assert.equal(resolveLink('not a url', 'also not a url'), null)
  })

  it('works on a dev server, where the origin has a port', () => {
    const local = 'http://localhost:3000/app?p=home'
    assert.deepEqual(resolveLink('http://localhost:3000/app?p=abc123', local), {
      kind: 'page',
      pageId: 'abc123',
    })
    // Same host, different port is a different origin.
    assert.deepEqual(resolveLink('http://localhost:3001/app?p=abc123', local), {
      kind: 'external',
      href: 'http://localhost:3001/app?p=abc123',
    })
  })
})
