import { describe, expect, it } from 'bun:test'

import { SERVE_BUILD_VERSION, serveClientVersionOf } from '../serve-version'

describe('serveClientVersionOf', () => {
  it('reports the release serve was built as when nothing names a version', () => {
    expect(serveClientVersionOf({ requested: undefined, build: '1.221.0' })).toBe('1.221.0')
  })

  it('keeps a version the launcher passes explicitly', () => {
    expect(serveClientVersionOf({ requested: '1.200.0', build: '1.221.0' })).toBe('1.200.0')
  })

  it('falls back to the compiled build version, dev for an unreleased build', () => {
    expect(serveClientVersionOf({ requested: undefined })).toBe(SERVE_BUILD_VERSION)
    expect(SERVE_BUILD_VERSION).toBe('dev')
  })
})
