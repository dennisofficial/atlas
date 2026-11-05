import { describe, expect, it } from 'bun:test'

import { rewriteSetCookie } from '../cookies'

describe('rewriteSetCookie', () => {
  it('adds the cross-site attributes to a bare cookie', () => {
    expect(rewriteSetCookie('sid=abc')).toBe('sid=abc; Secure; Partitioned; SameSite=None')
  })

  it('replaces an existing SameSite of any case', () => {
    expect(rewriteSetCookie('sid=abc; Path=/; SameSite=Lax; HttpOnly')).toBe(
      'sid=abc; Path=/; HttpOnly; Secure; Partitioned; SameSite=None',
    )
    expect(rewriteSetCookie('sid=abc; samesite = strict')).toBe(
      'sid=abc; Secure; Partitioned; SameSite=None',
    )
  })

  it('does not duplicate Secure or Partitioned', () => {
    expect(rewriteSetCookie('sid=abc; secure; PARTITIONED; SameSite=None')).toBe(
      'sid=abc; secure; PARTITIONED; SameSite=None',
    )
  })

  it('keeps values containing equals signs and attributes untouched', () => {
    expect(rewriteSetCookie('a=b=c; Max-Age=60; Domain=x.byatlas.dev')).toBe(
      'a=b=c; Max-Age=60; Domain=x.byatlas.dev; Secure; Partitioned; SameSite=None',
    )
  })
})
