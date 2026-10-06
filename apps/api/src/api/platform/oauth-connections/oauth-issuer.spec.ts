import { afterEach, describe, expect, it, vi } from 'vitest'
import { OauthRateLimitedError, OauthRejectedError, EOauthProvider } from './oauth-connections.types'
import { HttpOauthIssuer } from './oauth-issuer'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

const jwt = (claims: object) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

describe('HttpOauthIssuer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the Anthropic refresh grant and requires a replacement refresh token', async () => {
    const fetchMock = respond(200, {
      access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'user:inference user:profile',
    })
    vi.stubGlobal('fetch', fetchMock)

    const issued = await new HttpOauthIssuer().refresh({
      provider: EOauthProvider.Anthropic, refreshToken: 'old', nowMs: NOW,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://platform.claude.com/v1/oauth/token')
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: 'refresh_token', client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', refresh_token: 'old',
    })
    expect(issued).toEqual({
      accessToken: 'a', refreshToken: 'r', expiresAt: new Date(NOW + 3_600_000).toISOString(),
      scopes: ['user:inference', 'user:profile'],
    })

    vi.stubGlobal('fetch', respond(200, { access_token: 'a', expires_in: 60 }))
    await expect(
      new HttpOauthIssuer().refresh({ provider: EOauthProvider.Anthropic, refreshToken: 'old', nowMs: NOW }),
    ).rejects.toThrow(/unusable/)
  })

  it('keeps OpenAI semantics: optional rotation, JWT expiry fallback, account id', async () => {
    const exp = Math.floor(NOW / 1000) + 600
    const fetchMock = respond(200, {
      access_token: jwt({ exp }),
      id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const issued = await new HttpOauthIssuer().refresh({
      provider: EOauthProvider.OpenAI, refreshToken: 'old', nowMs: NOW,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://auth.openai.com/oauth/token')
    expect(JSON.parse(String(init.body)).client_id).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(issued.refreshToken).toBeUndefined()
    expect(issued.accountId).toBe('acct-1')
    expect(issued.expiresAt).toBe(new Date(exp * 1000).toISOString())
  })

  it('separates definitive rejection, rate limiting and uncertain failures', async () => {
    const attempt = () =>
      new HttpOauthIssuer().refresh({ provider: EOauthProvider.OpenAI, refreshToken: 'old', nowMs: NOW })

    vi.stubGlobal('fetch', respond(400, { error: 'invalid_grant' }))
    await expect(attempt()).rejects.toBeInstanceOf(OauthRejectedError)
    vi.stubGlobal('fetch', respond(429, {}))
    await expect(attempt()).rejects.toBeInstanceOf(OauthRateLimitedError)
    vi.stubGlobal('fetch', respond(503, {}))
    await expect(attempt()).rejects.not.toBeInstanceOf(OauthRejectedError)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    await expect(attempt()).rejects.toThrow('socket hang up')
  })
})
