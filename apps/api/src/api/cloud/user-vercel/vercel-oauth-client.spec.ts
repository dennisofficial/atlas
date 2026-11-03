import { describe, expect, it } from 'bun:test'
import {
  exchangeVercelAuthorizationCode,
  refreshVercelToken,
  VercelOauthRequestError,
  vercelAuthorizeUrl,
  vercelPkce,
} from './vercel-oauth-client'

import type { VercelFetch } from './vercel-oauth.types'

const fakeFetch =
  (
    handler: (url: string, body: URLSearchParams) => { status: number; json: unknown },
  ): VercelFetch =>
  async (input, init) => {
    const raw = init?.body
    const body = new URLSearchParams(raw instanceof URLSearchParams ? raw.toString() : '')
    const reply = handler(String(input), body)
    return new Response(JSON.stringify(reply.json), { status: reply.status })
  }

describe('vercelPkce', () => {
  it('makes a state, nonce and an S256 challenge pair', () => {
    const pkce = vercelPkce()
    expect(pkce.state).not.toBe(pkce.verifier)
    expect(pkce.challenge).not.toBe(pkce.verifier)
    expect(pkce.challenge.length).toBeGreaterThan(20)
  })
})

describe('vercelAuthorizeUrl', () => {
  it('carries every required parameter', () => {
    const url = new URL(
      vercelAuthorizeUrl({
        clientId: 'cl_1',
        redirectUri: 'https://api.example.com/v1/vercel/oauth/callback',
        state: 's',
        nonce: 'n',
        challenge: 'c',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://vercel.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cl_1')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid offline_access')
    expect(url.searchParams.get('state')).toBe('s')
    expect(url.searchParams.get('nonce')).toBe('n')
  })
})

describe('exchangeVercelAuthorizationCode', () => {
  it('posts the code grant form and returns the tokens', async () => {
    let seen: URLSearchParams | undefined
    const grant = await exchangeVercelAuthorizationCode({
      fetch: fakeFetch((url, body) => {
        seen = body
        expect(url).toBe('https://api.vercel.com/login/oauth/token')
        return {
          status: 200,
          json: { access_token: 'vca_1', refresh_token: 'vcr_1', expires_in: 3600 },
        }
      }),
      clientId: 'cl_1',
      clientSecret: 'secret',
      code: 'code',
      verifier: 'verifier',
      redirectUri: 'https://api.example.com/v1/vercel/oauth/callback',
    })
    expect(grant).toEqual({
      accessToken: 'vca_1',
      refreshToken: 'vcr_1',
      expiresIn: 3600,
      idToken: null,
    })
    expect(seen?.get('grant_type')).toBe('authorization_code')
    expect(seen?.get('code_verifier')).toBe('verifier')
    expect(seen?.get('client_secret')).toBe('secret')
  })

  it('surfaces the oauth error code', async () => {
    const failure = await exchangeVercelAuthorizationCode({
      fetch: fakeFetch(() => ({
        status: 400,
        json: { error: 'invalid_grant', error_description: 'code expired' },
      })),
      clientId: 'cl_1',
      clientSecret: 'secret',
      code: 'code',
      verifier: 'verifier',
      redirectUri: 'https://api.example.com/x',
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VercelOauthRequestError)
    expect((failure as VercelOauthRequestError).code).toBe('invalid_grant')
  })
})

describe('refreshVercelToken', () => {
  it('posts the refresh grant form', async () => {
    let seen: URLSearchParams | undefined
    await refreshVercelToken({
      fetch: fakeFetch((url, body) => {
        seen = body
        return {
          status: 200,
          json: { access_token: 'vca_2', refresh_token: 'vcr_2', expires_in: 3600 },
        }
      }),
      clientId: 'cl_1',
      clientSecret: 'secret',
      refreshToken: 'vcr_1',
    })
    expect(seen?.get('grant_type')).toBe('refresh_token')
    expect(seen?.get('refresh_token')).toBe('vcr_1')
  })
})
