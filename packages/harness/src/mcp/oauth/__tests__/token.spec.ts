import { describe, expect, it } from 'bun:test'

import type { ClockPort } from '@dltech/atlas-core'

import { EOAuthFailure, OAuthError } from '../oauth-error'
import type { Pkce } from '../pkce'
import { buildAuthorizationUrl, exchangeAuthorizationCode } from '../token'

const NOW = '2026-01-01T00:00:00.000Z'
const clock: ClockPort = { now: () => NOW }

const PKCE: Pkce = { verifier: 'the-verifier', challenge: 'the-challenge', state: 'the-state' }

const TOKEN_ENDPOINT = 'https://auth.example.com/token'

type Call = { url: string; headers: Record<string, string>; body: URLSearchParams }

const serverAnswering = (args: { status?: number; body?: unknown }) => {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    )
    calls.push({ url, headers, body: new URLSearchParams(String(init?.body ?? '')) })
    return new Response(JSON.stringify(args.body ?? {}), { status: args.status ?? 200 })
  }
  return { fetch, calls }
}

describe('buildAuthorizationUrl', () => {
  it('builds the authorization-code URL with the PKCE challenge', () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: 'https://auth.example.com/authorize',
        clientId: 'client-123',
        redirectUri: 'http://localhost:3000/callback',
        pkce: PKCE,
      }),
    )

    expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback')
    expect(url.searchParams.get('state')).toBe('the-state')
    expect(url.searchParams.get('scope')).toBeNull()
    expect(url.searchParams.get('resource')).toBeNull()
  })

  it('includes scope and resource when given', () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: 'https://auth.example.com/authorize',
        clientId: 'client-123',
        redirectUri: 'http://localhost:3000/callback',
        pkce: PKCE,
        scope: 'files:read',
        resource: 'https://mcp.example.com/server',
      }),
    )

    expect(url.searchParams.get('scope')).toBe('files:read')
    expect(url.searchParams.get('resource')).toBe('https://mcp.example.com/server')
  })
})

describe('exchangeAuthorizationCode', () => {
  it('posts a form-encoded authorization_code grant with the verifier', async () => {
    const { fetch, calls } = serverAnswering({ body: { access_token: 'access-1' } })

    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clock,
      fetch,
    })

    expect(tokens).toEqual({ accessToken: 'access-1' })
    expect(calls[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost:3000/callback',
      code_verifier: 'the-verifier',
      client_id: 'client-123',
    })
  })

  it('computes expiresAt from expires_in against the injected clock', async () => {
    const { fetch } = serverAnswering({
      body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
    })

    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clock,
      fetch,
    })

    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T01:00:00.000Z',
    })
  })

  it('authenticates with client_secret_basic when the server supports it', async () => {
    const { fetch, calls } = serverAnswering({ body: { access_token: 'access-1' } })

    await exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clientSecret: 'secret-xyz',
      tokenEndpointAuthMethodsSupported: ['client_secret_basic', 'client_secret_post'],
      clock,
      fetch,
    })

    const expected = Buffer.from('client-123:secret-xyz').toString('base64')
    expect(calls[0]?.headers['authorization']).toBe(`Basic ${expected}`)
    expect(calls[0]?.body.get('client_secret')).toBeNull()
  })

  it('falls back to client_secret_post when basic is not supported', async () => {
    const { fetch, calls } = serverAnswering({ body: { access_token: 'access-1' } })

    await exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clientSecret: 'secret-xyz',
      tokenEndpointAuthMethodsSupported: ['client_secret_post'],
      clock,
      fetch,
    })

    expect(calls[0]?.headers['authorization']).toBeUndefined()
    expect(calls[0]?.body.get('client_secret')).toBe('secret-xyz')
  })

  it('withholds the secret when the server only supports none', async () => {
    const { fetch, calls } = serverAnswering({ body: { access_token: 'access-1' } })

    await exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clientSecret: 'secret-xyz',
      tokenEndpointAuthMethodsSupported: ['none'],
      clock,
      fetch,
    })

    expect(calls[0]?.headers['authorization']).toBeUndefined()
    expect(calls[0]?.body.get('client_secret')).toBeNull()
    expect(calls[0]?.body.get('client_id')).toBe('client-123')
  })

  it('throws a typed error carrying the OAuth error code from the body', async () => {
    const { fetch } = serverAnswering({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'the code expired' },
    })

    const attempt = exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clock,
      fetch,
    })

    await expect(attempt).rejects.toBeInstanceOf(OAuthError)
    await expect(attempt).rejects.toMatchObject({
      failure: EOAuthFailure.TokenExchangeFailed,
      code: 'invalid_grant',
      status: 400,
      message: 'the code expired',
    })
  })

  it('throws a typed error on a bare HTTP failure', async () => {
    const { fetch } = serverAnswering({ status: 500 })

    const attempt = exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clock,
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      failure: EOAuthFailure.TokenExchangeFailed,
      status: 500,
      code: undefined,
    })
  })

  it('throws when the response carries no access_token', async () => {
    const { fetch } = serverAnswering({ body: { token_type: 'bearer' } })

    const attempt = exchangeAuthorizationCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'the-code',
      pkce: PKCE,
      redirectUri: 'http://localhost:3000/callback',
      clientId: 'client-123',
      clock,
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: 'the token response carries no access_token',
    })
  })
})
