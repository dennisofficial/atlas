import { EDefinitionOrigin } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EMcpRejection } from '@dltech/atlas-plugin-mcp/core'
import { loadMcpConfig } from '@dltech/atlas-plugin-mcp/pod'
import { describe, expect, it } from 'bun:test'

import { McpServerReader } from '../mcp-servers'
import { cipher, seedOwner, sealed } from './config-reader.fixture'

const testDb = useTestDatabase()

const readerOver = (db = testDb().db) => new McpServerReader({ db, cipher })

const seedServer = async (args: {
  db: ReturnType<typeof testDb>['db']
  id: string
  name: string
  scope: { userId: string } | { projectId: string }
  spec?: unknown
  sealedSpec?: string
  over?: Record<string, unknown>
}): Promise<void> => {
  await args.db.orm.public.McpServer.create({
    id: args.id,
    name: args.name,
    source: 'cloud',
    sealedSpec:
      args.sealedSpec ?? sealed(args.spec ?? { name: args.name, transport: stdio(args.id) }),
    ...args.scope,
    ...args.over,
  })
}

const GRANT_URL = 'https://mcp.example.com/mcp'

const grantOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  clientInfo: { clientId: 'cid' },
  tokens: {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    expiresAt: '2999-01-01T00:00:00.000Z',
    ...over,
  },
  tokenEndpoint: 'https://oauth.example.com/token',
  redirectUri: 'https://app.example.com/cb',
})

const seedGranted = async (args: {
  db: ReturnType<typeof testDb>['db']
  oauthStatus?: string
  oauthServerUrl?: string
  grant?: unknown
}): Promise<void> => {
  await seedServer({
    db: args.db,
    id: 'srv-posthog',
    name: 'posthog',
    scope: { projectId: 'proj-1' },
    spec: { name: 'posthog', transport: { kind: 'http', url: GRANT_URL } },
    over: {
      oauthStatus: args.oauthStatus ?? 'active',
      oauthServerUrl: args.oauthServerUrl ?? GRANT_URL,
      oauthSealed: sealed(args.grant ?? grantOf()),
    },
  })
}

const stdio = (command: string) => ({ kind: 'stdio' as const, command })

const noFiles = async (): Promise<string | null> => null

describe('McpServerReader', () => {
  it('unseals the session user rows and project rows', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedServer({ db, id: 'srv-user', name: 'docs', scope: { userId: 'user-1' } })
    await seedServer({ db, id: 'srv-project', name: 'tickets', scope: { projectId: 'proj-1' } })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rejections).toEqual([])
    expect(cloud.rows).toEqual([
      { source: 'user', spec: { name: 'docs', transport: stdio('srv-user') } },
      { source: 'project', spec: { name: 'tickets', transport: stdio('srv-project') } },
    ])
  })

  it('leaves out another user rows and rows that are not cloud', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.public.User.create({ id: 'user-2', name: 'v', email: 'v@test.local' })
    await seedServer({ db, id: 'srv-other', name: 'theirs', scope: { userId: 'user-2' } })
    await db.orm.public.McpServer.create({
      id: 'srv-repo',
      name: 'swept',
      source: 'repo',
      repoUrl: 'https://mcp.example.com/mcp',
      lastSeenAt: new Date(),
      userId: 'user-1',
    })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rows).toEqual([])
  })

  it('reports a row that will not open instead of throwing, and keeps its siblings', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedServer({
      db,
      id: 'srv-broken',
      name: 'broken',
      scope: { userId: 'user-1' },
      sealedSpec: 'not-a-blob',
    })
    await seedServer({ db, id: 'srv-docs', name: 'docs', scope: { userId: 'user-1' } })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rows.map((row) => row.spec)).toEqual([
      { name: 'docs', transport: stdio('srv-docs') },
    ])
    expect(cloud.rejections).toHaveLength(1)
    expect(cloud.rejections[0]?.rejection).toBe(EMcpRejection.Unreadable)
    expect(cloud.rejections[0]?.name).toBe('broken')
    expect(cloud.rejections[0]?.origin).toBe(EDefinitionOrigin.User)
  })

  it('reads nothing for a session that does not exist', async () => {
    expect(await readerOver().read({ sessionId: 's-nope' })).toEqual({ rows: [], rejections: [] })
  })
})

describe('the cloud oauth grant', () => {
  it('carries the access token of an active grant for the row url', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({ db })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rows).toEqual([
      {
        source: 'project',
        spec: { name: 'posthog', transport: { kind: 'http', url: GRANT_URL } },
        accessToken: 'at-1',
      },
    ])
  })

  it('leaves an expired grant without a token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({ db, grant: grantOf({ expiresAt: '2020-01-01T00:00:00.000Z' }) })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rows).toEqual([
      {
        source: 'project',
        spec: { name: 'posthog', transport: { kind: 'http', url: GRANT_URL } },
      },
    ])
  })

  it('leaves a grant made for another url without a token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({ db, oauthServerUrl: 'https://elsewhere.example.com/mcp' })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rows).toEqual([
      {
        source: 'project',
        spec: { name: 'posthog', transport: { kind: 'http', url: GRANT_URL } },
      },
    ])
  })

  it('leaves a grant that is not active without a token', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGranted({ db, oauthStatus: 'expired' })

    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    expect(cloud.rows).toEqual([
      {
        source: 'project',
        spec: { name: 'posthog', transport: { kind: 'http', url: GRANT_URL } },
      },
    ])
  })
})

describe('the cloud rows through the MCP config', () => {
  it('ranks a repo file over a project row over a user row', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedServer({ db, id: 'srv-user', name: 'docs', scope: { userId: 'user-1' } })
    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    const fromUser = await loadMcpConfig({ cloud, directory: '/repo', read: noFiles })
    expect(fromUser.servers.map((server) => server.transport)).toEqual([stdio('srv-user')])

    await seedServer({ db, id: 'srv-project', name: 'docs', scope: { projectId: 'proj-1' } })
    const withProject = await readerOver(db).read({ sessionId: 's-1' })
    const fromProject = await loadMcpConfig({
      cloud: withProject,
      directory: '/repo',
      read: noFiles,
    })
    expect(fromProject.servers.map((server) => server.transport)).toEqual([stdio('srv-project')])
    expect(fromProject.servers[0]?.origin).toBe(EDefinitionOrigin.Project)

    const files: Record<string, string> = {
      '/repo/.atlas/mcp.json': JSON.stringify({
        mcpServers: { docs: { transport: stdio('repo-server') } },
      }),
    }
    const fromRepo = await loadMcpConfig({
      cloud: withProject,
      directory: '/repo',
      read: async (path) => files[path] ?? null,
    })
    expect(fromRepo.servers.map((server) => server.transport)).toEqual([stdio('repo-server')])
  })

  it('carries a rejection from the sealed rows into the merged config', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedServer({
      db,
      id: 'srv-broken',
      name: 'broken',
      scope: { userId: 'user-1' },
      sealedSpec: 'x.y.z',
    })
    const cloud = await readerOver(db).read({ sessionId: 's-1' })

    const merged = await loadMcpConfig({ cloud, directory: null, read: noFiles })

    expect(merged.servers).toEqual([])
    expect(merged.rejections.map((rejection) => rejection.name)).toEqual(['broken'])
  })
})
