import { describe, expect, test } from 'bun:test'

import { chromeUrl, safeFramePath, splitFramePath } from '../frame-path'

describe('splitFramePath', () => {
  test('separates pathname and search', () => {
    expect(splitFramePath('/a/b?x=1&y=2')).toEqual({ pathname: '/a/b', search: 'x=1&y=2' })
    expect(splitFramePath('/a')).toEqual({ pathname: '/a', search: '' })
  })
})

describe('safeFramePath', () => {
  const fallback = '/sign-in'
  test('accepts same-origin paths', () => {
    expect(safeFramePath({ raw: '/threads/a?state=busy', fallback })).toBe('/threads/a?state=busy')
  })

  test('rejects external, protocol-relative, missing and chrome-recursive paths', () => {
    expect(safeFramePath({ raw: 'https://evil.test', fallback })).toBe(fallback)
    expect(safeFramePath({ raw: '//evil.test', fallback })).toBe(fallback)
    expect(safeFramePath({ raw: undefined, fallback })).toBe(fallback)
    expect(safeFramePath({ raw: '/proto?path=/x', fallback })).toBe(fallback)
  })
})

describe('chromeUrl', () => {
  test('encodes the page path and keeps the viewport', () => {
    expect(chromeUrl({ path: '/a?b=1', viewport: 'full' })).toBe('/proto?path=%2Fa%3Fb%3D1&vp=full')
  })
})
