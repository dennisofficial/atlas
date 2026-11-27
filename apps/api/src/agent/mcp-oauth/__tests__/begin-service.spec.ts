import type { Db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { seedGroup, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { McpOauthBeginService } from '../begin-service'
import type { McpOauthBeginArgs, McpOauthGateway } from '../types'
import { cipher, seedCloudServer } from './fixtures'

const testDb = useTestDatabase()

const AUTHORIZE_URL = 'https://auth.example.com/authorize?state=1'

const gatewayOf = (calls: McpOauthBeginArgs[]): McpOauthGateway => ({
  begin: async (args) => {
    calls.push(args)
    return {
      ok: true,
      url: AUTHORIZE_URL,
      startUrl: 'https://api.byatlas.io/return/start/s',
      expiresAt: 'x',
    }
  },
  refresh: async () => ({ ok: false, reason: 'unused' }),
})

const serviceOver = (args: { db: Db; calls?: McpOauthBeginArgs[] }) =>
  new McpOauthBeginService({
    db: args.db,
    cipher,
    gateway: gatewayOf(args.calls ?? []),
  })

const bodyOf = (args: {
  serverId: string
  scope?: 'user' | 'project' | 'group'
  surface?: 'web' | 'desktop'
}) => ({
  serverId: args.serverId,
  surface: args.surface ?? ('web' as const),
  screen:
    args.scope === 'project'
      ? ({ kind: 'settings', scope: 'project', id: 'proj-1' } as const)
      : args.scope === 'group'
        ? ({ kind: 'settings', scope: 'group', id: 'grp-1' } as const)
        : ({ kind: 'settings', scope: 'user' } as const),
})

describe('McpOauthBeginService', () => {
  it('refuses an unknown server', async () => {
    const { db } = testDb()
    await seedOwner(db)

    const answer = await serviceOver({ db }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'nope' }),
    })

    expect(answer.status).toBe(404)
  })

  it('refuses a server of another user', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await seedCloudServer({ db, name: 'posthog', scope: { userId: 'user-2' } })

    const answer = await serviceOver({ db }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'srv-posthog' }),
    })

    expect(answer.status).toBe(403)
  })

  it('refuses a project screen the caller does not own', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    const answer = await serviceOver({ db }).begin({
      userId: 'user-2',
      body: bodyOf({ serverId: 'srv-posthog', scope: 'project' }),
    })

    expect(answer.status).toBe(403)
  })

  it('begins the flow with the screen the settings page named', async () => {
    const { db } = testDb()
    const calls: McpOauthBeginArgs[] = []
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    const answer = await serviceOver({ db, calls }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'srv-posthog' }),
    })

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ url: 'https://api.byatlas.io/return/start/s?surface=web' })
    expect(calls[0]).toMatchObject({
      userId: 'user-1',
      source: 'cloud',
      name: 'posthog',
      returnTarget: { surface: 'web', screen: { kind: 'settings', scope: 'user' } },
    })
  })

  it('names the surface an older client asked for, which opens the link unchanged', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })

    const answer = await serviceOver({ db, calls: [] }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'srv-posthog', surface: 'desktop' }),
    })

    expect(answer.body).toEqual({ url: 'https://api.byatlas.io/return/start/s?surface=desktop' })
  })

  it('begins a project server in the project it lives in', async () => {
    const { db } = testDb()
    const calls: McpOauthBeginArgs[] = []
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog', scope: { projectId: 'proj-1' } })

    const answer = await serviceOver({ db, calls }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'srv-posthog', scope: 'project' }),
    })

    expect(answer.status).toBe(200)
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

    const answer = await serviceOver({ db }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'rmcp_1', scope: 'project' }),
    })

    expect(answer.status).toBe(200)
  })

  it('begins a group server the signer owns the group of', async () => {
    const { db } = testDb()
    const calls: McpOauthBeginArgs[] = []
    await seedOwner(db)
    await seedGroup(db)
    await seedCloudServer({ db, name: 'posthog', scope: { groupId: 'grp-1' } })

    const answer = await serviceOver({ db, calls }).begin({
      userId: 'user-1',
      body: bodyOf({ serverId: 'srv-posthog', scope: 'group' }),
    })

    expect(answer.status).toBe(200)
    expect(calls[0]).toMatchObject({
      groupId: 'grp-1',
      returnTarget: { surface: 'web', screen: { kind: 'settings', scope: 'group', id: 'grp-1' } },
    })
    expect(calls[0]?.projectId).toBeUndefined()
  })

  it('refuses a group screen the caller does not own', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await seedCloudServer({ db, name: 'posthog', scope: { groupId: 'grp-1' } })

    const answer = await serviceOver({ db }).begin({
      userId: 'user-2',
      body: bodyOf({ serverId: 'srv-posthog', scope: 'group' }),
    })

    expect(answer.status).toBe(403)
    expect(answer.body).toEqual({ reason: 'group' })
  })

  it('refuses a group server whose group the signer does not own', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await seedCloudServer({ db, name: 'posthog', scope: { groupId: 'grp-1' } })

    const answer = await serviceOver({ db }).begin({
      userId: 'user-2',
      body: bodyOf({ serverId: 'srv-posthog' }),
    })

    expect(answer.status).toBe(403)
    expect(answer.body).toEqual({ reason: 'server' })
  })
})
