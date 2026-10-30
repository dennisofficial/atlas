import { describe, expect, it } from 'bun:test'
import { EMcpOauthAccessOutcome, EMcpOauthGrantStatus } from '@dltech/atlas-wire'
import { AUTH, SERVER, TEST_CONFIG, json } from './mcp-oauth.fakes'
import { sealJson } from './mcp-oauth-seal'
import { EGrantRowStatus } from './mcp-oauth.types'
import type { SealedGrant } from './mcp-oauth.types'
import { build, NORMALIZED, seedGrant, START } from './mcp-oauth.testkit'

describe('McpOauthAccessService.accessToken', () => {
  const refreshHandler = (env: ReturnType<typeof build>) => {
    let count = 0
    env.fetcher.on(`${AUTH}/token`, async () => {
      count += 1
      await Promise.resolve()
      return json({
        access_token: `access-r${count}`,
        refresh_token: `refresh-r${count}`,
        expires_in: 3600,
      })
    })
  }

  it('needs auth without a grant', async () => {
    const env = build()
    expect(await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })).toEqual({
      outcome: EMcpOauthAccessOutcome.NeedsAuth,
    })
  })

  it('returns a fresh token without refreshing', async () => {
    const env = build()
    await seedGrant(env)
    const result = await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })
    expect(result).toMatchObject({
      outcome: EMcpOauthAccessOutcome.Granted,
      accessToken: 'access-0',
    })
    expect(env.fetcher.calls).toHaveLength(0)
  })

  it('refreshes when the rejected token matches, rotating the refresh token', async () => {
    const env = build()
    await seedGrant(env)
    refreshHandler(env)
    const result = await env.access.accessToken({
      userId: 'user-a',
      serverUrl: SERVER,
      rejectedAccessToken: 'access-0',
    })
    expect(result).toMatchObject({ accessToken: 'access-r1' })
    const body = new URLSearchParams(String(env.fetcher.callsTo(`${AUTH}/token`)[0]?.init?.body))
    expect(body.get('refresh_token')).toBe('refresh-0')
    expect(body.get('resource')).toBe(SERVER)
    const again = await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })
    expect(again).toMatchObject({ accessToken: 'access-r1' })
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(1)
  })

  it('does not refresh for a rejected token that is already stale', async () => {
    const env = build()
    await seedGrant(env)
    const result = await env.access.accessToken({
      userId: 'user-a',
      serverUrl: SERVER,
      rejectedAccessToken: 'something-older',
    })
    expect(result).toMatchObject({ accessToken: 'access-0' })
  })

  it('refreshes an expiring token', async () => {
    const env = build()
    await seedGrant(env, { expiresAt: new Date(START + 30_000).toISOString() })
    refreshHandler(env)
    const result = await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })
    expect(result).toMatchObject({ accessToken: 'access-r1' })
  })

  it('marks the grant expired on invalid_grant', async () => {
    const env = build()
    await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    env.fetcher.on(`${AUTH}/token`, () => json({ error: 'invalid_grant' }, 400))
    const result = await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
    const status = await env.oauth.status({ userId: 'user-a', serverUrls: [SERVER] })
    expect(status[0]?.status).toBe(EMcpOauthGrantStatus.Expired)
  })

  it('marks the grant expired when there is no refresh token', async () => {
    const env = build()
    const grant: SealedGrant = {
      clientInfo: { clientId: 'client-1' },
      tokens: { accessToken: 'access-0', expiresAt: new Date(START - 1).toISOString() },
      tokenEndpoint: `${AUTH}/token`,
      redirectUri: TEST_CONFIG.redirectUri,
    }
    await env.store.upsertGrant({
      userId: 'user-a',
      serverUrl: NORMALIZED,
      sealed: sealJson({ cipher: env.cipher, value: grant }),
    })
    const result = await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('throws on a server error and keeps the grant usable', async () => {
    const env = build()
    await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    env.fetcher.on(`${AUTH}/token`, () => new Response('boom', { status: 503 }))
    await expect(env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })).rejects.toThrow()
    const row = await env.store.findGrant({ userId: 'user-a', serverUrl: NORMALIZED })
    expect(row?.status).toBe(EGrantRowStatus.Active)
    expect(row?.refreshAttempt).toBeNull()
  })

  it('issues a single refresh for concurrent callers', async () => {
    const env = build()
    await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    refreshHandler(env)
    const results = await Promise.all(
      [0, 1, 2].map(() => env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })),
    )
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(1)
    for (const result of results) expect(result).toMatchObject({ accessToken: 'access-r1' })
  })

  it('never serves another user their grant', async () => {
    const env = build()
    await seedGrant(env)
    const result = await env.access.accessToken({ userId: 'user-b', serverUrl: SERVER })
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('takes over a stale refresh claim', async () => {
    const env = build()
    await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    refreshHandler(env)
    const row = [...env.store.grants.values()][0]
    if (row === undefined) throw new Error('no grant')
    row.refreshAttempt = 'dead-attempt'
    row.refreshStartedAt = new Date(START - 60_000)
    const result = await env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })
    expect(result).toMatchObject({ accessToken: 'access-r1' })
  })

  it('waits on a live claim instead of refreshing', async () => {
    const env = build()
    await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    refreshHandler(env)
    const row = [...env.store.grants.values()][0]
    if (row === undefined) throw new Error('no grant')
    row.refreshAttempt = 'live-attempt'
    row.refreshStartedAt = new Date(START)
    await expect(env.access.accessToken({ userId: 'user-a', serverUrl: SERVER })).rejects.toThrow()
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(0)
  })
})
