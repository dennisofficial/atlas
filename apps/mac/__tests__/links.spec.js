import { describe, expect, test } from 'bun:test'

import { externalUrlOf, sameOrigin } from '../links.js'

describe('externalUrlOf', () => {
  test('hands a web address to the default browser', () => {
    expect(externalUrlOf('https://github.com/dennisofficial/atlas/pull/993')).toBe(
      'https://github.com/dennisofficial/atlas/pull/993',
    )
    expect(externalUrlOf('http://example.com/a?q=1')).toBe('http://example.com/a?q=1')
  })

  test('hands a mail address to the default mail client', () => {
    expect(externalUrlOf('mailto:hello@byatlas.io')).toBe('mailto:hello@byatlas.io')
  })

  test('refuses anything the shell is not allowed to open', () => {
    expect(externalUrlOf('javascript:alert(1)')).toBe(null)
    expect(externalUrlOf('file:///etc/passwd')).toBe(null)
    expect(externalUrlOf('chrome://settings')).toBe(null)
  })

  test('refuses what is not a usable address', () => {
    expect(externalUrlOf('')).toBe(null)
    expect(externalUrlOf('github.com/atlas')).toBe(null)
    expect(externalUrlOf(undefined)).toBe(null)
    expect(externalUrlOf({ toString: () => 'https://example.com' })).toBe(null)
  })
})

describe('sameOrigin', () => {
  test('keeps a page on one origin inside the pane that shows it', () => {
    expect(sameOrigin('https://3100-abc.byatlas.dev/docs', 'https://3100-abc.byatlas.dev/')).toBe(
      true,
    )
    expect(sameOrigin('http://127.0.0.1:4100/app', 'http://127.0.0.1:4100/')).toBe(true)
  })

  test('treats another port, host or protocol as somewhere else', () => {
    expect(sameOrigin('http://127.0.0.1:4101/app', 'http://127.0.0.1:4100/')).toBe(false)
    expect(sameOrigin('https://example.com/', 'https://github.com/')).toBe(false)
    expect(sameOrigin('https://example.com/', 'http://example.com/')).toBe(false)
  })

  test('compares origins only, so a path never decides it', () => {
    expect(sameOrigin('https://example.com/other', 'https://example.com/')).toBe(true)
  })

  test('has nothing in common with a non-web address or an unloaded pane', () => {
    expect(sameOrigin('mailto:hello@byatlas.io', 'mailto:hello@byatlas.io')).toBe(false)
    expect(sameOrigin('about:blank', 'about:blank')).toBe(false)
    expect(sameOrigin('https://example.com/', '')).toBe(false)
    expect(sameOrigin('https://example.com/', undefined)).toBe(false)
  })
})
