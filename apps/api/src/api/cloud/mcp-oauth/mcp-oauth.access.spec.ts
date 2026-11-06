import { describe, expect, it } from 'bun:test'
import { EMcpOauthAccessOutcome, EMcpServerSource } from '@dltech/atlas-wire'
import { AUTH, SERVER, TEST_CONFIG, json } from './mcp-oauth.fakes'
import { sealJson } from './mcp-oauth-seal'
import { EGrantRowStatus } from './mcp-oauth.types'
import type { SealedGrant } from './mcp-oauth.types'
import {
  accessArgs,
  addCloudServer,
  build,
  NORMALIZED,
  seedGrant,
  START,
} from './mcp-oauth.testkit'

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
    const server = await addCloudServer(env)
    expect(await env.access.accessToken(accessArgs(server))).toEqual({
      outcome: EMcpOauthAccessOutcome.NeedsAuth,
    })
  })

  it('needs auth when no server row exists at all', async () => {
    const env = build()
    const result = await env.access.accessToken({
      userId: 'user-a',
      name: 'ghost',
      source: EMcpServerSource.Cloud,
      url: SERVER,
    })
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('returns a fresh token without refreshing', async () => {
    const env = build()
    const server = await seedGrant(env)
    const result = await env.access.accessToken(accessArgs(server))
    expect(result).toMatchObject({
      outcome: EMcpOauthAccessOutcome.Granted,
      accessToken: 'access-0',
    })
    expect(env.fetcher.calls).toHaveLength(0)
  })

  it('refreshes when the rejected token matches, rotating the refresh token', async () => {
    const env = build()
    const server = await seedGrant(env)
    refreshHandler(env)
    const result = await env.access.accessToken(
      accessArgs(server, { rejectedAccessToken: 'access-0' }),
    )
    expect(result).toMatchObject({ accessToken: 'access-r1' })
    const body = new URLSearchParams(String(env.fetcher.callsTo(`${AUTH}/token`)[0]?.init?.body))
    expect(body.get('refresh_token')).toBe('refresh-0')
    expect(body.get('resource')).toBe(SERVER)
    const again = await env.access.accessToken(accessArgs(server))
    expect(again).toMatchObject({ accessToken: 'access-r1' })
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(1)
  })

  it('does not refresh for a rejected token that is already stale', async () => {
    const env = build()
    const server = await seedGrant(env)
    const result = await env.access.accessToken(
      accessArgs(server, { rejectedAccessToken: 'something-older' }),
    )
    expect(result).toMatchObject({ accessToken: 'access-0' })
  })

  it('refreshes an expiring token', async () => {
    const env = build()
    const server = await seedGrant(env, { expiresAt: new Date(START + 30_000).toISOString() })
    refreshHandler(env)
    const result = await env.access.accessToken(accessArgs(server))
    expect(result).toMatchObject({ accessToken: 'access-r1' })
  })

  it('marks the grant expired on invalid_grant', async () => {
    const env = build()
    const server = await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    env.fetcher.on(`${AUTH}/token`, () => json({ error: 'invalid_grant' }, 400))
    const result = await env.access.accessToken(accessArgs(server))
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
    const row = await env.store.findServer({ id: server.id })
    expect(row?.oauthStatus).toBe(EGrantRowStatus.Expired)
  })

  it('marks the grant expired when there is no refresh token', async () => {
    const env = build()
    const server = await addCloudServer(env)
    const grant: SealedGrant = {
      clientInfo: { clientId: 'client-1' },
      tokens: { accessToken: 'access-0', expiresAt: new Date(START - 1).toISOString() },
      tokenEndpoint: `${AUTH}/token`,
      redirectUri: TEST_CONFIG.redirectUri,
    }
    await env.store.writeGrant({
      id: server.id,
      serverUrl: NORMALIZED,
      sealed: sealJson({ cipher: env.cipher, value: grant }),
    })
    const result = await env.access.accessToken(accessArgs(server))
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('throws on a server error and keeps the grant usable', async () => {
    const env = build()
    const server = await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    env.fetcher.on(`${AUTH}/token`, () => new Response('boom', { status: 503 }))
    await expect(env.access.accessToken(accessArgs(server))).rejects.toThrow()
    const row = await env.store.findServer({ id: server.id })
    expect(row?.oauthStatus).toBe(EGrantRowStatus.Active)
    expect(row?.oauthRefreshAttempt).toBeNull()
  })

  it('issues a single refresh for concurrent callers', async () => {
    const env = build()
    const server = await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    refreshHandler(env)
    const results = await Promise.all(
      [0, 1, 2].map(() => env.access.accessToken(accessArgs(server))),
    )
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(1)
    for (const result of results) expect(result).toMatchObject({ accessToken: 'access-r1' })
  })

  it('never serves another user their grant', async () => {
    const env = build()
    const server = await seedGrant(env)
    const result = await env.access.accessToken(accessArgs(server, { userId: 'user-b' }))
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('needs auth when the requested url differs from the granted url', async () => {
    const env = build()
    const server = await seedGrant(env)
    const result = await env.access.accessToken(
      accessArgs(server, { url: 'https://evil.example.com/mcp' }),
    )
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('takes over a stale refresh claim', async () => {
    const env = build()
    const server = await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    refreshHandler(env)
    const row = env.store.servers.get(server.id)
    if (row === undefined) throw new Error('no server')
    row.oauthRefreshAttempt = 'dead-attempt'
    row.oauthRefreshStartedAt = new Date(START - 60_000)
    const result = await env.access.accessToken(accessArgs(server))
    expect(result).toMatchObject({ accessToken: 'access-r1' })
  })

  it('takes over a leftover claim of any age because the lock proves no refresh is running', async () => {
    const env = build()
    const server = await seedGrant(env, { expiresAt: new Date(START - 1).toISOString() })
    refreshHandler(env)
    const row = env.store.servers.get(server.id)
    if (row === undefined) throw new Error('no server')
    row.oauthRefreshAttempt = 'dead-attempt'
    row.oauthRefreshStartedAt = new Date(START)
    const result = await env.access.accessToken(accessArgs(server))
    expect(result).toMatchObject({ accessToken: 'access-r1' })
    expect(env.fetcher.callsTo(`${AUTH}/token`)).toHaveLength(1)
  })
})

describe('McpOauthAccessService repo servers', () => {
  it('creates the repo row and answers needs-auth on first contact', async () => {
    const env = build()
    const result = await env.access.accessToken({
      userId: 'user-a',
      name: 'repo-server',
      source: EMcpServerSource.Repo,
      url: SERVER,
    })
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
    const rows = await env.store.listServers({ userId: 'user-a' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'repo-server', repoUrl: NORMALIZED, source: 'repo' })
  })

  it('grants a repo server after a grant is written for it', async () => {
    const env = build()
    const repo = await env.store.touchRepoServer({
      userId: 'user-a',
      name: 'repo-server',
      url: NORMALIZED,
      now: new Date(START),
    })
    const grant: SealedGrant = {
      clientInfo: { clientId: 'client-1' },
      tokens: { accessToken: 'access-0', expiresAt: new Date(START + 3_600_000).toISOString() },
      tokenEndpoint: `${AUTH}/token`,
      redirectUri: TEST_CONFIG.redirectUri,
    }
    await env.store.writeGrant({
      id: repo.id,
      serverUrl: NORMALIZED,
      sealed: sealJson({ cipher: env.cipher, value: grant }),
    })
    const result = await env.access.accessToken({
      userId: 'user-a',
      name: 'repo-server',
      source: EMcpServerSource.Repo,
      url: SERVER,
    })
    expect(result).toMatchObject({ outcome: EMcpOauthAccessOutcome.Granted })
  })

  it('keeps the grant but answers needs-auth when the repo url changed', async () => {
    const env = build()
    const repo = await env.store.touchRepoServer({
      userId: 'user-a',
      name: 'repo-server',
      url: NORMALIZED,
      now: new Date(START),
    })
    await env.store.writeGrant({
      id: repo.id,
      serverUrl: NORMALIZED,
      sealed: sealJson({
        cipher: env.cipher,
        value: {
          clientInfo: { clientId: 'client-1' },
          tokens: { accessToken: 'access-0' },
          tokenEndpoint: `${AUTH}/token`,
          redirectUri: TEST_CONFIG.redirectUri,
        } satisfies SealedGrant,
      }),
    })
    const moved = 'https://moved.example.com/mcp'
    const result = await env.access.accessToken({
      userId: 'user-a',
      name: 'repo-server',
      source: EMcpServerSource.Repo,
      url: moved,
    })
    expect(result.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
    const row = await env.store.findServer({ id: repo.id })
    expect(row?.repoUrl).toBe(new URL(moved).toString())
    expect(row?.oauthServerUrl).toBe(NORMALIZED)
    expect(row?.oauthStatus).toBe(EGrantRowStatus.Active)
  })
})
