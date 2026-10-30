import { describe, expect, it } from 'bun:test'
import { EMcpOauthBeginOutcome } from '@dltech/atlas-wire'
import { AUTH, SERVER, TEST_CONFIG, installIssuer, json } from './mcp-oauth.fakes'
import { build, seedGrant } from './mcp-oauth.testkit'

describe('McpOauthService.begin', () => {
  it('registers a client and returns an authorization url pinned to the resource', async () => {
    const env = build()
    const result = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    if (result.outcome !== EMcpOauthBeginOutcome.Redirect) throw new Error('expected redirect')
    const url = new URL(result.authorizationUrl)
    expect(url.origin).toBe(AUTH)
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe(TEST_CONFIG.redirectUri)
    expect(url.searchParams.get('resource')).toBe(SERVER)
    expect(url.searchParams.get('scope')).toBe('read')
    expect(env.store.pendings.size).toBe(1)
  })

  it('reuses the stored client when the redirect uri matches', async () => {
    const env = build()
    await seedGrant(env)
    await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(env.fetcher.callsTo(`${AUTH}/register`)).toHaveLength(0)
  })

  it('is unsupported when the server needs no sign-in', async () => {
    const env = build()
    env.fetcher.on(SERVER, () => json({ result: {} }))
    const result = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(result).toEqual({
      outcome: EMcpOauthBeginOutcome.Unsupported,
      reason: 'server does not require sign-in',
    })
  })

  it('is unsupported without a registration endpoint', async () => {
    const env = build()
    installIssuer(env.fetcher, { registration: false })
    const result = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
  })

  it('rejects private and non-https targets before any fetch', async () => {
    const env = build()
    for (const serverUrl of [
      'http://mcp.example.com/mcp',
      'https://127.0.0.1/mcp',
      'https://localhost/mcp',
      'https://169.254.169.254/x',
      'https://[::1]/mcp',
    ]) {
      const result = await env.oauth.begin({ userId: 'user-a', serverUrl })
      expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
    }
    expect(env.fetcher.calls).toHaveLength(0)
  })

  it('rejects a discovered endpoint that points at a private host', async () => {
    const env = build()
    env.fetcher.on(`${AUTH}/.well-known/oauth-authorization-server`, () =>
      json({
        authorization_endpoint: `${AUTH}/authorize`,
        token_endpoint: 'https://10.0.0.5/token',
        registration_endpoint: `${AUTH}/register`,
      }),
    )
    const result = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
    expect(env.fetcher.callsTo(`${AUTH}/register`)).toHaveLength(0)
  })
})
