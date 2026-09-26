import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPlainLeftClick, looksLikeUrl, normalizeHref, pageHref, resolveLink } from '@/lib/util/links'

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
    // Someone else's Jottr. It is a different workspace, and this one cannot
    // render its pages.
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
    assert.deepEqual(resolveLink('tel:+441234567890', HERE), {
      kind: 'external',
      href: 'tel:+441234567890',
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

  it('follows a page link copied from a dev server in place', () => {
    // Stored before page links went relative, or pasted from the address bar.
    assert.deepEqual(resolveLink('http://localhost:3000/app?p=abc123', HERE), {
      kind: 'page',
      pageId: 'abc123',
    })
    assert.deepEqual(resolveLink('http://127.0.0.1:3000/app?p=abc123', HERE), {
      kind: 'page',
      pageId: 'abc123',
    })
    // Only page links: anything else on a dev server is still somewhere else.
    assert.deepEqual(resolveLink('http://localhost:3000/login', HERE), {
      kind: 'external',
      href: 'http://localhost:3000/login',
    })
  })

  it('works on a dev server, where the origin has a port', () => {
    const local = 'http://localhost:3000/app?p=home'
    assert.deepEqual(resolveLink('http://localhost:3000/app?p=abc123', local), {
      kind: 'page',
      pageId: 'abc123',
    })
  })
})

describe('normalizeHref', () => {
  it('assumes https for a bare host, the way a typed link field should', () => {
    assert.equal(normalizeHref('example.com'), 'https://example.com')
    assert.equal(normalizeHref('  example.com/docs  '), 'https://example.com/docs')
  })

  it('leaves anything that already names a scheme alone', () => {
    assert.equal(normalizeHref('https://example.com'), 'https://example.com')
    assert.equal(normalizeHref('HTTP://example.com'), 'HTTP://example.com')
    // Used to come back as https://mailto:… , which went nowhere.
    assert.equal(normalizeHref('mailto:someone@example.com'), 'mailto:someone@example.com')
    assert.equal(normalizeHref('tel:+441234567890'), 'tel:+441234567890')
    assert.equal(normalizeHref('tel:12345'), 'tel:12345')
  })

  it('reads a host and port as a host, not as a scheme', () => {
    // Stored as typed, these went nowhere when clicked.
    assert.equal(normalizeHref('example.com:8080/docs'), 'https://example.com:8080/docs')
    assert.equal(normalizeHref('localhost:3000'), 'https://localhost:3000')
    assert.equal(looksLikeUrl('localhost:3000'), true)
  })

  it('leaves a link to one of your own pages alone', () => {
    // Re-applying an internal link used to produce https:///app?p=abc123.
    assert.equal(normalizeHref('/app?p=abc123'), '/app?p=abc123')
  })

  it('has nothing to say about an empty field', () => {
    assert.equal(normalizeHref('   '), '')
  })
})

describe('looksLikeUrl', () => {
  it('recognises what someone means as a destination', () => {
    assert.equal(looksLikeUrl('https://example.com'), true)
    assert.equal(looksLikeUrl('example.com'), true)
    assert.equal(looksLikeUrl('mailto:someone@example.com'), true)
    assert.equal(looksLikeUrl('/app?p=abc123'), true)
  })

  it('treats ordinary words as a page search', () => {
    assert.equal(looksLikeUrl('meeting notes'), false)
    // A colon is punctuation in a page title far more often than it is a scheme.
    assert.equal(looksLikeUrl('Meeting: agenda'), false)
    assert.equal(looksLikeUrl('Q3'), false)
    assert.equal(looksLikeUrl(''), false)
  })
})

describe('pageHref', () => {
  it('addresses a page the same way the workspace does', () => {
    assert.deepEqual(resolveLink(pageHref('abc123'), HERE), { kind: 'page', pageId: 'abc123' })
  })
})

describe('isPlainLeftClick', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

  it('follows a plain left click in place', () => {
    assert.equal(isPlainLeftClick(click), true)
  })

  it('leaves a middle click or a held modifier to the browser', () => {
    assert.equal(isPlainLeftClick({ ...click, button: 1 }), false)
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      assert.equal(isPlainLeftClick({ ...click, [key]: true }), false, key)
    }
  })
})
