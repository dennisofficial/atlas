import { describe, expect, it } from 'bun:test'

import { rawSessionToken } from '../raw-session-token'

describe('rawSessionToken', () => {
  it('returns a plain token unchanged', () => {
    expect(rawSessionToken('abc123')).toBe('abc123')
  })

  it('drops the signature of a signed cookie value', () => {
    expect(rawSessionToken('abc123.c2lnbmF0dXJl')).toBe('abc123')
  })

  it('decodes a percent-encoded signed value', () => {
    expect(rawSessionToken('abc123.c2ln%2Bnature%3D')).toBe('abc123')
    expect(rawSessionToken('abc%2E123')).toBe('abc')
  })

  it('keeps a malformed percent sequence as typed', () => {
    expect(rawSessionToken('abc%zz.sig')).toBe('abc%zz')
  })

  it('returns undefined for empty input', () => {
    expect(rawSessionToken('')).toBeUndefined()
    expect(rawSessionToken('   ')).toBeUndefined()
    expect(rawSessionToken('.sig')).toBeUndefined()
  })
})
