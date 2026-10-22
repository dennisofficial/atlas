import { describe, expect, it } from 'bun:test'

import type { ClockPort } from '@dltech/atlas-core'

import { EOAuthFailure } from '../oauth-error'
import { refreshAuthorization } from '../token'

const NOW = '2026-01-01T00:00:00.000Z'
const clock: ClockPort = { now: () => NOW }

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

describe('refreshAuthorization', () => {
  it('posts a form-encoded refresh_token grant', async () => {
    const { fetch, calls } = serverAnswering({
      body: { access_token: 'access-2', refresh_token: 'refresh-2' },
    })

    const tokens = await refreshAuthorization({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'refresh-1',
      clientId: 'client-123',
      clock,
      fetch,
    })

    expect(tokens).toEqual({ accessToken: 'access-2', refreshToken: 'refresh-2' })
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'client-123',
    })
  })

  it('preserves the old refresh token when the response omits one', async () => {
    const { fetch } = serverAnswering({ body: { access_token: 'access-2', expires_in: 60 } })

    const tokens = await refreshAuthorization({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'refresh-1',
      clientId: 'client-123',
      clock,
      fetch,
    })

    expect(tokens).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      expiresAt: '2026-01-01T00:01:00.000Z',
    })
  })

  it('authenticates with client_secret_basic when the server supports it', async () => {
    const { fetch, calls } = serverAnswering({ body: { access_token: 'access-2' } })

    await refreshAuthorization({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'refresh-1',
      clientId: 'client-123',
      clientSecret: 'secret-xyz',
      tokenEndpointAuthMethodsSupported: ['client_secret_basic'],
      clock,
      fetch,
    })

    const expected = Buffer.from('client-123:secret-xyz').toString('base64')
    expect(calls[0]?.headers['authorization']).toBe(`Basic ${expected}`)
  })

  it('normalizes a non-standard refresh error code to invalid_grant', async () => {
    const { fetch } = serverAnswering({ status: 400, body: { error: 'invalid_refresh_token' } })

    const attempt = refreshAuthorization({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'refresh-1',
      clientId: 'client-123',
      clock,
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({
      failure: EOAuthFailure.TokenExchangeFailed,
      code: 'invalid_grant',
    })
  })

  it('normalizes expired_refresh_token and token_expired to invalid_grant', async () => {
    for (const error of ['expired_refresh_token', 'token_expired']) {
      const { fetch } = serverAnswering({ status: 400, body: { error } })

      const attempt = refreshAuthorization({
        tokenEndpoint: TOKEN_ENDPOINT,
        refreshToken: 'refresh-1',
        clientId: 'client-123',
        clock,
        fetch,
      })

      await expect(attempt).rejects.toMatchObject({ code: 'invalid_grant' })
    }
  })

  it('passes through standard error codes untouched', async () => {
    const { fetch } = serverAnswering({
      status: 400,
      body: { error: 'temporarily_unavailable' },
    })

    const attempt = refreshAuthorization({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'refresh-1',
      clientId: 'client-123',
      clock,
      fetch,
    })

    await expect(attempt).rejects.toMatchObject({ code: 'temporarily_unavailable' })
  })
})
