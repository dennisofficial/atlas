import { describe, expect, it } from 'bun:test'
import { EMcpOauthBeginOutcome, mcpOauthBeginInputSchema } from '@dltech/atlas-wire'
import { AUTH, SERVER, json } from './mcp-oauth.fakes'
import { build, stateOf } from './mcp-oauth.testkit'

const beginWith = async (returnTo?: string) => {
  const env = build()
  const result = await env.oauth.begin({
    userId: 'user-a',
    serverUrl: SERVER,
    ...(returnTo === undefined ? {} : { returnTo }),
  })
  if (result.outcome !== EMcpOauthBeginOutcome.Redirect) throw new Error('expected redirect')
  env.fetcher.on(`${AUTH}/token`, () => json({ access_token: 'a', expires_in: 3600 }))
  return { env, state: stateOf(result.authorizationUrl) }
}

describe('returnTo open redirect', () => {
  it('rejects backslash and control characters in the wire schema', () => {
    for (const returnTo of ['/\\evil.com', '/\\/evil.com', '/\t/evil.com', '//evil.com', '/a\nb']) {
      expect(mcpOauthBeginInputSchema.safeParse({ serverUrl: SERVER, returnTo }).success).toBe(
        false,
      )
    }
    expect(
      mcpOauthBeginInputSchema.safeParse({ serverUrl: SERVER, returnTo: '/settings?x=1' }).success,
    ).toBe(true)
  })

  it('falls back to the default path when the origin differs', async () => {
    for (const returnTo of ['/\\evil.com', '/\\/evil.com', '/\t/evil.com']) {
      const { env, state } = await beginWith(returnTo)
      const location = new URL(
        await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
      )
      expect(location.origin).toBe('https://web.test')
      expect(location.pathname).toBe('/settings/integrations')
    }
  })
})

describe('callback session binding', () => {
  it('fails and consumes the pending on a session mismatch', async () => {
    const { env, state } = await beginWith()
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-b' }),
    )
    expect(location.searchParams.get('mcpReason')).toBe('session_mismatch')
    expect(env.store.pendings.size).toBe(0)
    expect(env.store.grants.size).toBe(0)
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(0)
  })

  it('fails without a session', async () => {
    const { env, state } = await beginWith()
    const location = new URL(await env.oauth.complete({ state, code: 'c' }))
    expect(location.searchParams.get('mcpReason')).toBe('session_mismatch')
    expect(env.store.grants.size).toBe(0)
  })

  it('connects when the session matches', async () => {
    const { env, state } = await beginWith()
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpOauth')).toBe('connected')
  })

  it('fails on malformed query values', async () => {
    const { env, state } = await beginWith()
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a', malformed: true }),
    )
    expect(location.searchParams.get('mcpOauth')).toBe('failed')
  })

  it('reports exchange_failed when the token endpoint throws', async () => {
    const { env, state } = await beginWith()
    env.fetcher.on(`${AUTH}/token`, () => {
      throw new Error('network down')
    })
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpReason')).toBe('exchange_failed')
  })
})

describe('begin robustness and client reuse', () => {
  it('is unsupported when a request fails at the network', async () => {
    const env = build()
    env.fetcher.on(SERVER, () => {
      throw new Error('ECONNRESET')
    })
    const result = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
  })

  it('is unsupported when DNS resolves to a private address', async () => {
    const env = build({
      ...(await import('./mcp-oauth.fakes')).TEST_CONFIG,
      resolveHost: async () => ['10.0.0.9'],
    })
    const result = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
    expect(env.fetcher.calls).toHaveLength(0)
  })

  it('pins the resource declared by the metadata and rejects a mismatch', async () => {
    const env = build()
    const prm = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'
    env.fetcher.on(prm, () => json({ authorization_servers: [AUTH], resource: `${SERVER}/` }))
    const ok = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(ok.outcome).toBe(EMcpOauthBeginOutcome.Redirect)
    env.fetcher.on(prm, () =>
      json({ authorization_servers: [AUTH], resource: 'https://evil.example.com/mcp' }),
    )
    const bad = await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(bad.outcome).toBe(EMcpOauthBeginOutcome.Unsupported)
  })

  it('does not reuse a client registered against another token endpoint', async () => {
    const env = build()
    const { seedGrant } = await import('./mcp-oauth.testkit')
    await seedGrant(env)
    env.fetcher.on(`${AUTH}/.well-known/oauth-authorization-server`, () =>
      json({
        authorization_endpoint: `${AUTH}/authorize`,
        token_endpoint: `${AUTH}/token2`,
        registration_endpoint: `${AUTH}/register`,
      }),
    )
    await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(env.fetcher.callsTo(`${AUTH}/register`)).toHaveLength(1)
  })

  it('does not reuse an expired client secret', async () => {
    const env = build()
    const { NORMALIZED, START } = await import('./mcp-oauth.testkit')
    const { sealJson } = await import('./mcp-oauth-seal')
    await env.store.upsertGrant({
      userId: 'user-a',
      serverUrl: NORMALIZED,
      sealed: sealJson({
        cipher: env.cipher,
        value: {
          clientInfo: {
            clientId: 'old',
            clientSecret: 's',
            clientSecretExpiresAt: START / 1000 - 10,
          },
          tokens: { accessToken: 'x' },
          tokenEndpoint: `${AUTH}/token`,
          redirectUri: (await import('./mcp-oauth.fakes')).TEST_CONFIG.redirectUri,
        },
      }),
    })
    await env.oauth.begin({ userId: 'user-a', serverUrl: SERVER })
    expect(env.fetcher.callsTo(`${AUTH}/register`)).toHaveLength(1)
  })
})
