import { describe, expect, it } from 'bun:test'
import { EMcpOauthBeginOutcome, EMcpOauthGrantStatus } from '@dltech/atlas-wire'
import { AUTH, SERVER, json } from './mcp-oauth.fakes'
import { build, NORMALIZED, seedGrant, stateOf } from './mcp-oauth.testkit'

describe('McpOauthService.complete', () => {
  const begun = async () => {
    const env = build()
    const result = await env.oauth.begin({
      userId: 'user-a',
      serverUrl: SERVER,
      returnTo: '/settings/integrations?tab=mcp',
    })
    if (result.outcome !== EMcpOauthBeginOutcome.Redirect) throw new Error('expected redirect')
    env.fetcher.on(`${AUTH}/token`, () =>
      json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }),
    )
    return { env, state: stateOf(result.authorizationUrl) }
  }

  it('exchanges the code, stores the grant and redirects to the web', async () => {
    const { env, state } = await begun()
    const location = new URL(
      await env.oauth.complete({ state, code: 'code-1', sessionUserId: 'user-a' }),
    )
    expect(location.origin).toBe('https://web.test')
    expect(location.pathname).toBe('/settings/integrations')
    expect(location.searchParams.get('tab')).toBe('mcp')
    expect(location.searchParams.get('mcpOauth')).toBe('connected')
    expect(location.searchParams.get('mcpServer')).toBe(NORMALIZED)
    const body = new URLSearchParams(String(env.fetcher.callsTo(`${AUTH}/token`)[0]?.init?.body))
    expect(body.get('resource')).toBe(SERVER)
    expect(body.get('code')).toBe('code-1')
    const status = await env.oauth.status({ userId: 'user-a', serverUrls: [SERVER] })
    expect(status[0]?.status).toBe(EMcpOauthGrantStatus.Connected)
  })

  it('is single use', async () => {
    const { env, state } = await begun()
    await env.oauth.complete({ state, code: 'code-1', sessionUserId: 'user-a' })
    const again = new URL(
      await env.oauth.complete({ state, code: 'code-1', sessionUserId: 'user-a' }),
    )
    expect(again.searchParams.get('mcpOauth')).toBe('failed')
    expect(again.searchParams.get('mcpReason')).toBe('unknown_state')
  })

  it('fails on an unknown state', async () => {
    const { env } = await begun()
    const location = new URL(
      await env.oauth.complete({ state: 'nope', code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpOauth')).toBe('failed')
  })

  it('fails on an expired state', async () => {
    const { env, state } = await begun()
    env.clock.current += 11 * 60_000
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpReason')).toBe('expired')
    expect(env.store.grants.size).toBe(0)
  })

  it('reports a provider error without exchanging', async () => {
    const { env, state } = await begun()
    const location = new URL(
      await env.oauth.complete({
        state,
        sessionUserId: 'user-a',
        error: 'access_denied',
        errorDescription: 'user said no',
      }),
    )
    expect(location.searchParams.get('mcpOauth')).toBe('failed')
    expect(location.searchParams.get('mcpReason')).toBe('user said no')
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(0)
  })

  it('reports a failed token exchange', async () => {
    const { env, state } = await begun()
    env.fetcher.on(`${AUTH}/token`, () => json({ error: 'invalid_grant' }, 400))
    const location = new URL(
      await env.oauth.complete({ state, code: 'bad', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpOauth')).toBe('failed')
    expect(env.store.grants.size).toBe(0)
  })
})

describe('McpOauthService status and disconnect', () => {
  it('reports connected, expired and none, scoped to the user', async () => {
    const env = build()
    await seedGrant(env)
    await seedGrant(env, {}, 'user-b')
    const other = 'https://other.example.com/mcp'
    const result = await env.oauth.status({ userId: 'user-a', serverUrls: [SERVER, other] })
    expect(result.map((grant) => grant.status)).toEqual([
      EMcpOauthGrantStatus.Connected,
      EMcpOauthGrantStatus.None,
    ])
    await env.oauth.disconnect({ userId: 'user-a', serverUrl: SERVER })
    const after = await env.oauth.status({ userId: 'user-a', serverUrls: [SERVER] })
    expect(after[0]?.status).toBe(EMcpOauthGrantStatus.None)
    expect(env.store.grants.size).toBe(1)
  })
})
