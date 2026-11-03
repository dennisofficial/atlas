import { describe, expect, it } from 'bun:test'

import {
  buildAuthorizeUrl,
  ECallbackResult,
  parseAuthCallback,
  webRedirectUri,
} from '../pending-auth'

describe('buildAuthorizeUrl', () => {
  it('builds the desktop authorize URL with PKCE parameters', () => {
    const url = new URL(
      buildAuthorizeUrl({
        webOrigin: 'https://byatlas.io',
        redirectUri: 'atlas://auth/callback',
        state: 'state-1',
        codeChallenge: 'challenge-1',
      }),
    )
    expect(url.origin).toBe('https://byatlas.io')
    expect(url.pathname).toBe('/desktop/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe('atlas://auth/callback')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('trims a trailing slash from the web origin', () => {
    const url = buildAuthorizeUrl({
      webOrigin: 'https://byatlas.io/',
      redirectUri: 'atlas://auth/callback',
      state: 's',
      codeChallenge: 'c',
    })
    expect(url.startsWith('https://byatlas.io/desktop/authorize?')).toBe(true)
  })
})

describe('webRedirectUri', () => {
  it('appends the callback path to the origin', () => {
    expect(webRedirectUri({ origin: 'http://localhost:8081' })).toBe(
      'http://localhost:8081/auth/callback',
    )
  })
})

describe('parseAuthCallback', () => {
  it('extracts the code when the state matches', () => {
    const outcome = parseAuthCallback({
      url: 'atlas://auth/callback?code=abc&state=s1',
      expectedState: 's1',
    })
    expect(outcome).toEqual({ kind: ECallbackResult.Success, code: 'abc' })
  })

  it('rejects a state mismatch', () => {
    const outcome = parseAuthCallback({
      url: 'atlas://auth/callback?code=abc&state=other',
      expectedState: 's1',
    })
    expect(outcome).toEqual({ kind: ECallbackResult.StateMismatch })
  })

  it('rejects a missing state', () => {
    const outcome = parseAuthCallback({
      url: 'atlas://auth/callback?code=abc',
      expectedState: 's1',
    })
    expect(outcome).toEqual({ kind: ECallbackResult.StateMismatch })
  })

  it('reports a missing code when the state matches', () => {
    const outcome = parseAuthCallback({
      url: 'atlas://auth/callback?state=s1',
      expectedState: 's1',
    })
    expect(outcome).toEqual({ kind: ECallbackResult.MissingCode })
  })
})
