import { describe, expect, it } from 'bun:test'
import { EMcpOauthBeginOutcome, EMcpOauthGrantStatus } from '@dltech/atlas-wire'
import { AUTH, SERVER, json } from './mcp-oauth.fakes'
import { EGrantRowStatus } from './mcp-oauth.types'
import { addCloudServer, build, NORMALIZED, seedGrant, stateOf } from './mcp-oauth.testkit'

describe('McpOauthService.complete', () => {
  const begun = async () => {
    const env = build()
    const server = await addCloudServer(env)
    const result = await env.oauth.begin({
      userId: 'user-a',
      serverId: server.id,
      returnTo: '/settings/integrations?tab=mcp',
    })
    if (result.outcome !== EMcpOauthBeginOutcome.Redirect) throw new Error('expected redirect')
    env.fetcher.on(`${AUTH}/token`, () =>
      json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }),
    )
    return { env, server, state: stateOf(result.authorizationUrl) }
  }

  const statusOf = async (env: ReturnType<typeof build>, id: string) =>
    (await env.store.findServer({ id }))?.oauthStatus ?? null

  it('exchanges the code, stores the grant and redirects to the web', async () => {
    const { env, server, state } = await begun()
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
    expect(await statusOf(env, server.id)).toBe(EGrantRowStatus.Active)
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
    const { env, server, state } = await begun()
    env.clock.current += 11 * 60_000
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpReason')).toBe('expired')
    expect(await statusOf(env, server.id)).toBeNull()
  })

  it('fails with server_changed when the row is gone', async () => {
    const { env, server, state } = await begun()
    env.store.servers.delete(server.id)
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpReason')).toBe('server_changed')
  })

  it('fails with server_changed when the url moved', async () => {
    const { env, server, state } = await begun()
    const stored = env.store.servers.get(server.id)
    if (stored === undefined) throw new Error('no server')
    stored.sealedSpec = env.cipher.encrypt(
      JSON.stringify({
        name: server.name,
        transport: { kind: 'http', url: 'https://moved.example.com/mcp' },
      }),
    )
    const location = new URL(
      await env.oauth.complete({ state, code: 'c', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpReason')).toBe('server_changed')
    expect(await statusOf(env, server.id)).toBeNull()
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
    const { env, server, state } = await begun()
    env.fetcher.on(`${AUTH}/token`, () => json({ error: 'invalid_grant' }, 400))
    const location = new URL(
      await env.oauth.complete({ state, code: 'bad', sessionUserId: 'user-a' }),
    )
    expect(location.searchParams.get('mcpOauth')).toBe('failed')
    expect(await statusOf(env, server.id)).toBeNull()
  })
})

describe('McpOauthService servers, disconnect and forget', () => {
  it('reports connected, expired and none for the scope', async () => {
    const env = build()
    const server = await seedGrant(env)
    const other = await addCloudServer(env, {
      name: 'linear',
      url: 'https://linear.example.com/mcp',
    })
    const listed = await env.oauth.servers({ userId: 'user-a' })
    expect(listed.map((entry) => entry.status)).toEqual([
      EMcpOauthGrantStatus.None,
      EMcpOauthGrantStatus.Connected,
    ])
    expect(listed.map((entry) => entry.name)).toEqual(['linear', 'posthog'])
    await env.oauth.disconnect({ userId: 'user-a', serverId: server.id })
    const after = await env.oauth.servers({ userId: 'user-a' })
    expect(after.find((entry) => entry.id === server.id)?.status).toBe(EMcpOauthGrantStatus.None)
    expect((await env.store.findServer({ id: server.id }))?.oauthSealed).toBeNull()
    expect((await env.store.findServer({ id: other.id }))?.name).toBe('linear')
  })

  it('reports an expired grant as expired', async () => {
    const env = build()
    const server = await seedGrant(env)
    const stored = env.store.servers.get(server.id)
    if (stored === undefined) throw new Error('no server')
    stored.oauthStatus = EGrantRowStatus.Expired
    const listed = await env.oauth.servers({ userId: 'user-a' })
    expect(listed[0]?.status).toBe(EMcpOauthGrantStatus.Expired)
  })

  it('lists project servers only to the project owner', async () => {
    const env = build()
    await addCloudServer(env, { projectId: 'proj-1', projectOwner: 'user-a', name: 'proj-server' })
    const listed = await env.oauth.servers({ userId: 'user-a', projectId: 'proj-1' })
    expect(listed.map((entry) => entry.name)).toEqual(['proj-server'])
    await expect(env.oauth.servers({ userId: 'user-b', projectId: 'proj-1' })).rejects.toThrow(
      'project not found',
    )
  })

  it('forget removes a repo row and refuses a cloud row', async () => {
    const env = build()
    const repo = await env.store.touchRepoServer({
      userId: 'user-a',
      name: 'repo-server',
      url: SERVER,
      now: new Date(env.clock.now()),
    })
    await env.oauth.forget({ userId: 'user-a', serverId: repo.id })
    expect(await env.store.findServer({ id: repo.id })).toBeNull()
    const cloud = await addCloudServer(env)
    await expect(env.oauth.forget({ userId: 'user-a', serverId: cloud.id })).rejects.toThrow(
      'remove cloud servers from the MCP list',
    )
    expect(await env.store.findServer({ id: cloud.id })).not.toBeNull()
  })
})
