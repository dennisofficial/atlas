import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { mcpOauthBeginOf } from '../begin-route'
import type { McpOauthBeginArgs, McpOauthGateway } from '../types'
import { cipher, seedCloudServer } from './fixtures'

const testDb = useTestDatabase()

const gatewayOf = (calls: McpOauthBeginArgs[]): McpOauthGateway => ({
  begin: async (args) => {
    calls.push(args)
    return { ok: true, url: 'https://auth.example.com/authorize?state=1', expiresAt: 'x' }
  },
  refresh: async () => ({ ok: false, reason: 'unused' }),
})

const routeOver = (args: {
  db: Db
  calls?: McpOauthBeginArgs[]
  userId?: string
  trusted?: readonly string[]
}) =>
  mcpOauthBeginOf({
    db: args.db,
    cipher,
    gateway: gatewayOf(args.calls ?? []),
    resolve: async (bearer) =>
      bearer === 'token-1' ? { userId: args.userId ?? 'user-1' } : undefined,
    trustedOrigins: args.trusted ?? [],
  })

const postOf = (args: {
  body: unknown
  bearer?: string
  origin?: string
  method?: string
  path?: string
}): Request =>
  new Request(`https://agent.byatlas.io${args.path ?? '/mcp-oauth/begin'}`, {
    method: args.method ?? 'POST',
    headers: {
      ...(args.bearer === undefined ? {} : { authorization: `Bearer ${args.bearer}` }),
      ...(args.origin === undefined ? {} : { origin: args.origin }),
      'content-type': 'application/json',
    },
    ...(args.method === 'OPTIONS' ? {} : { body: JSON.stringify(args.body) }),
  })

const bodyOf = (args: { serverId: string; scope?: 'user' | 'project' }) => ({
  serverId: args.serverId,
  surface: 'web',
  screen:
    args.scope === 'project'
      ? { kind: 'settings', scope: 'project', id: 'proj-1' }
      : { kind: 'settings', scope: 'user' },
})

describe('the mcp oauth begin route', () => {
  it('leaves every other path and method to the stream server', async () => {
    const { db } = testDb()
    expect(await routeOver({ db })(postOf({ body: {}, path: '/healthz' }))).toBeNull()
  })

  it('answers the preflight with the cors headers', async () => {
    const { db } = testDb()

    const answer = await routeOver({ db, trusted: ['https://byatlas.io'] })(
      postOf({ body: {}, method: 'OPTIONS', origin: 'https://byatlas.io' }),
    )

    expect(answer?.status).toBe(204)
    expect(answer?.headers.get('access-control-allow-origin')).toBe('https://byatlas.io')
    expect(answer?.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('refuses an origin the host does not trust', async () => {
    const { db } = testDb()

    const answer = await routeOver({ db, trusted: ['https://byatlas.io'] })(
      postOf({ body: {}, origin: 'https://evil.example', bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(403)
  })

  it('refuses a request with no bearer', async () => {
    const { db } = testDb()

    const answer = await routeOver({ db })(postOf({ body: {} }))

    expect(answer?.status).toBe(401)
  })

  it('refuses an unknown server', async () => {
    const { db } = testDb()
    await seedOwner(db)

    const answer = await routeOver({ db })(
      postOf({ body: bodyOf({ serverId: 'nope' }), bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(404)
  })

  it("refuses a server of another user's", async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await seedCloudServer({ db, name: 'posthog', scope: { userId: 'user-2' } })

    const answer = await routeOver({ db })(
      postOf({ body: bodyOf({ serverId: 'srv-posthog' }), bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(403)
  })

  it('refuses a project screen the caller does not own', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    const answer = await routeOver({ db, userId: 'user-2' })(
      postOf({ body: bodyOf({ serverId: 'srv-posthog', scope: 'project' }), bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(403)
  })

  it('begins the flow with the screen the settings page named', async () => {
    const { db } = testDb()
    const calls: McpOauthBeginArgs[] = []
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    const answer = await routeOver({ db, calls })(
      postOf({ body: bodyOf({ serverId: 'srv-posthog' }), bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({ url: 'https://auth.example.com/authorize?state=1' })
    expect(calls[0]).toMatchObject({
      userId: 'user-1',
      source: 'cloud',
      name: 'posthog',
      returnTarget: { surface: 'web', screen: { kind: 'settings', scope: 'user' } },
    })
  })

  it('begins a project server in the project it lives in', async () => {
    const { db } = testDb()
    const calls: McpOauthBeginArgs[] = []
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog', scope: { projectId: 'proj-1' } })

    const answer = await routeOver({ db, calls })(
      postOf({ body: bodyOf({ serverId: 'srv-posthog', scope: 'project' }), bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(200)
    expect(calls[0]?.projectId).toBe('proj-1')
  })

  it('answers a github-authenticated repo row it cannot sign in', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.McpServer.create({
      id: 'rmcp_1',
      projectId: 'proj-1',
      source: 'repo',
      name: 'swept',
      repoUrl: 'https://mcp.example.com/mcp',
      lastSeenAt: new Date(),
    })

    const answer = await routeOver({ db })(
      postOf({ body: bodyOf({ serverId: 'rmcp_1', scope: 'project' }), bearer: 'token-1' }),
    )

    expect(answer?.status).toBe(200)
  })
})
