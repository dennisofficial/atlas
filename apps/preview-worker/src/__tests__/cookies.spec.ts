import { describe, expect, it } from 'bun:test'

import { isThirdPartyFrameRequest, rewriteSetCookie } from '../cookies'

describe('isThirdPartyFrameRequest', () => {
  const request = (site?: string, destination?: string) => {
    const headers: Record<string, string> = {}
    if (site !== undefined) headers['sec-fetch-site'] = site
    if (destination !== undefined) headers['sec-fetch-dest'] = destination
    return new Request('https://3000-abcdefghij.byatlas.dev/', { headers })
  }

  it.each(['empty', 'iframe'])('is true for cross-site %p requests', (destination) => {
    expect(isThirdPartyFrameRequest(request('cross-site', destination))).toBe(true)
  })

  it('is false for a cross-site top-level document', () => {
    expect(isThirdPartyFrameRequest(request('cross-site', 'document'))).toBe(false)
  })

  it('is true for a cross-site request without sec-fetch-dest', () => {
    expect(isThirdPartyFrameRequest(request('cross-site'))).toBe(true)
  })

  it.each(['same-origin', 'same-site', 'none'])('is false for sec-fetch-site %p', (site) => {
    for (const destination of ['document', 'iframe', 'empty']) {
      expect(isThirdPartyFrameRequest(request(site, destination))).toBe(false)
    }
  })

  it('is false when sec-fetch-site is missing', () => {
    expect(isThirdPartyFrameRequest(request(undefined, 'iframe'))).toBe(false)
    expect(isThirdPartyFrameRequest(request())).toBe(false)
  })
})

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
