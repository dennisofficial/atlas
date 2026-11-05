import { describe, expect, it } from 'bun:test'

import { isAtlasWebOrigin, isPreviewHost } from '../origins'

describe('isPreviewHost', () => {
  it('accepts minted preview hosts', () => {
    expect(isPreviewHost('3000-abcdefghij.byatlas.dev')).toBe(true)
    expect(isPreviewHost('51-a1b2c3d4e5.byatlas.dev')).toBe(true)
    expect(isPreviewHost('65535-0123456789.byatlas.dev')).toBe(true)
  })

  it.each([
    '3000-abcdefghij.byatlas.dev.evil.com',
    'evil.com',
    'byatlas.dev',
    'x.3000-abcdefghij.byatlas.dev',
    '3000-abcdefghij.byatlas.devx',
    '3000-abcdefghij.byatlas.dev.',
    '3000-abcdefghij-byatlas.dev',
    '3000-abcdefghi.byatlas.dev',
    '3000-abcdefghijk.byatlas.dev',
    '3000-ABCDEFGHIJ.byatlas.dev',
    '3-abcdefghij.byatlas.dev',
    '123456-abcdefghij.byatlas.dev',
    'a000-abcdefghij.byatlas.dev',
    '3000-abcdefghij.byatlas.io',
    '3000-abcdefghij.byatlas.dev:8080',
    '3000-abcdefghij.xbyatlas.dev',
    '3000-abcdefghij.byatlas.dev\n',
    '',
  ])('rejects %p', (host) => {
    expect(isPreviewHost(host)).toBe(false)
  })
})

describe('isAtlasWebOrigin', () => {
  it.each(['https://byatlas.io', 'https://3001-abcdefghij.byatlas.dev', 'http://localhost:3001'])(
    'accepts %p',
    (origin) => {
      expect(isAtlasWebOrigin(origin)).toBe(true)
    },
  )

  it.each([
    'https://byatlas.io.evil.com',
    'https://app.byatlas.io',
    'https://evilbyatlas.io',
    'http://byatlas.io',
    'https://byatlas.io:444',
    'https://evil.com',
    'https://evil.com/byatlas.io',
    'http://localhost.evil.com:3000',
    'http://localhost',
    'https://localhost:3000',
    'https://3001-abcdefghij.byatlas.dev.evil.com',
    'https://sub.byatlas.dev',
    'null',
    '',
  ])('rejects %p', (origin) => {
    expect(isAtlasWebOrigin(origin)).toBe(false)
  })
})
