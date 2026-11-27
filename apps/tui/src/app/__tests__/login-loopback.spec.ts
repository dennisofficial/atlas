import { describe, expect, it } from 'bun:test'

import { EReturnResult } from '@dltech/atlas-core'

import {
  authorizeUrlOf,
  DESKTOP_CALLBACK_PATH,
  LOGIN_COPY,
  loginRedirectUriOf,
  loginReturnOf,
} from '../account/login-loopback'

const WEB = 'https://byatlas.io/'

const STATE = 'state-1'

describe('the loopback an Atlas login comes back on', () => {
  it('names the desktop callback on the bound loopback port', () => {
    expect(DESKTOP_CALLBACK_PATH).toBe('/desktop/auth/callback')
    expect(loginRedirectUriOf(53682)).toBe('http://127.0.0.1:53682/desktop/auth/callback')
  })

  it('asks the web page to authorize a pkce sign-in', () => {
    const url = new URL(
      authorizeUrlOf({
        webOrigin: WEB,
        redirectUri: loginRedirectUriOf(53682),
        challenge: 'challenge-1',
        state: STATE,
      }),
    )

    expect(url.origin).toBe('https://byatlas.io')
    expect(url.pathname).toBe('/desktop/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:53682/desktop/auth/callback',
    )
    expect(url.searchParams.get('state')).toBe(STATE)
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('takes the code of its own state and nothing else', () => {
    expect(
      loginReturnOf({ url: `http://127.0.0.1:53682/cb?code=code-1&state=${STATE}`, state: STATE }),
    ).toEqual({
      page: { result: EReturnResult.Connected },
      value: { code: 'code-1' },
    })
    expect(
      loginReturnOf({ url: 'http://127.0.0.1:53682/cb?code=code-1&state=state-2', state: STATE }),
    ).toBeUndefined()
    expect(
      loginReturnOf({ url: 'http://127.0.0.1:53682/cb?code=&state=state-1', state: STATE }),
    ).toBeUndefined()
    expect(
      loginReturnOf({ url: 'http://127.0.0.1:53682/cb?state=state-1', state: STATE }),
    ).toBeUndefined()
    expect(loginReturnOf({ url: 'not a url', state: STATE })).toBeUndefined()
  })

  it('tells the browser the sign-in worked', () => {
    expect(LOGIN_COPY.connected).toBe('Signed in to Atlas.')
    expect(LOGIN_COPY.failed()).toBe('Sign-in failed: the browser did not come back with a code')
  })
})
