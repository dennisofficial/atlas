import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GithubService } from '@dltech/atlas-github'
import { createPersonalApp, trpcMutate, trpcQuery } from '../personal-resources.router.fixture'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { GroupsService } from '../project-groups/project-groups.service'
import { ProjectsService } from '../projects/projects.service'
import { McpServersRouter } from './mcp-servers.router'
import { McpServersService } from './mcp-servers.service'

describe('McpServersRouter', () => {
  useTestDatabase()
  const servers = () => db.orm.public.McpServer.where({ source: 'cloud' }).all()
  let app: INestApplication
  const put = (input: object, token = 'session-a') =>
    trpcMutate({ app, procedure: 'mcpServers.put', token, input })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await createPersonalApp([
      McpServersRouter,
      McpServersService,
      ProjectsService,
      GroupsService,
      { provide: GithubService, useValue: { findToken: async () => undefined } },
    ])
  })

  afterEach(() => app.close())

  it('accepts a well-formed stdio spec and lists it back', async () => {
    await put({
      name: 'fs',
      transport: { kind: 'stdio', command: 'npx', args: ['-y', 'srv'] },
    }).expect(200)

    const listed = await trpcQuery({
      app,
      procedure: 'mcpServers.list',
      token: 'session-a',
    }).expect(200)
    expect(listed.headers['cache-control']).toBe('no-store')
    expect(listed.body.result.data.servers).toEqual([
      {
        name: 'fs',
        transport: { kind: 'stdio', command: 'npx', args: ['-y', 'srv'] },
        updatedAt: expect.any(String),
      },
    ])
  })

  it('accepts a disabled server with no transport', async () => {
    await put({ name: 'paused', disabled: true }).expect(200)
  })

  it('rejects an unknown property', async () => {
    await put({ name: 'fs', transport: { kind: 'stdio', command: 'npx' }, bogus: true }).expect(400)
  })

  it('rejects an unknown transport property', async () => {
    await put({ name: 'fs', transport: { kind: 'stdio', command: 'npx', bogus: true } }).expect(400)
  })

  it('rejects a transport kind outside the union', async () => {
    await put({ name: 'fs', transport: { kind: 'sse', url: 'https://mcp.example.com' } }).expect(
      400,
    )
  })

  it('rejects a transport that is not an object', async () => {
    await put({ name: 'fs', transport: 'stdio' }).expect(400)
  })

  it('rejects a spec with neither transport nor disabled', async () => {
    await put({ name: 'empty' }).expect(400)
    await put({ name: 'empty', trusted: true }).expect(400)
    expect(await servers()).toHaveLength(0)
  })

  it('removes only the caller’s server', async () => {
    await put({ name: 'fs', disabled: true }).expect(200)
    await put({ name: 'fs', disabled: true }, 'session-b').expect(200)

    const removed = await trpcMutate({
      app,
      procedure: 'mcpServers.remove',
      token: 'session-a',
      input: { name: 'fs' },
    }).expect(200)

    expect(removed.body).toEqual({ result: {} })
    expect((await servers()).map((row) => row.userId)).toEqual(['user-b'])
  })

  it('requires a session on every procedure', async () => {
    await trpcQuery({ app, procedure: 'mcpServers.list' }).expect(401)
    await trpcMutate({ app, procedure: 'mcpServers.remove', input: { name: 'fs' } }).expect(401)
  })

  const studioTransport = { kind: 'stdio' as const, command: 'npx', args: ['-y', 'studio'] }

  const createGroup = async (args: { id: string; userId: string; name: string }) => {
    await db.orm.public.ProjectGroup.create(args)
  }

  const createProject = async (args: { id: string; ownerUserId: string; groupId?: string }) => {
    await db.orm.public.Project.create({
      id: args.id,
      name: args.id,
      repo: 'o/r',
      ownerUserId: args.ownerUserId,
      createdById: args.ownerUserId,
      ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
    })
  }

  it('keeps a group server apart from the personal list and refuses another user group', async () => {
    await createGroup({ id: 'grp-a', userId: 'user-a', name: 'Comp AI' })

    await put({
      name: 'studio',
      transport: studioTransport,
      scope: 'group',
      groupId: 'grp-a',
    }).expect(200)

    const listed = await trpcQuery({
      app,
      procedure: 'mcpServers.list',
      token: 'session-a',
      input: { scope: 'group', groupId: 'grp-a' },
    }).expect(200)
    expect(listed.body.result.data.servers).toMatchObject([
      { name: 'studio', transport: studioTransport },
    ])

    const personal = await trpcQuery({
      app,
      procedure: 'mcpServers.list',
      token: 'session-a',
    }).expect(200)
    expect(personal.body.result.data.servers).toEqual([])

    await trpcQuery({
      app,
      procedure: 'mcpServers.list',
      token: 'session-b',
      input: { scope: 'group', groupId: 'grp-a' },
    }).expect(404)
    await put(
      { name: 'studio', transport: studioTransport, scope: 'group', groupId: 'grp-a' },
      'session-b',
    ).expect(404)
  })

  it('lays personal, group, project and repo servers in order and marks the shadowed ones', async () => {
    await createGroup({ id: 'grp-a', userId: 'user-a', name: 'Comp AI' })
    await createProject({ id: 'prj-1', ownerUserId: 'user-a', groupId: 'grp-a' })
    await db.orm.public.McpServer.create({
      id: 'mcp_repo',
      projectId: 'prj-1',
      source: 'repo',
      name: 'from-repo',
      repoUrl: 'https://github.com/o/r',
      lastSeenAt: new Date(),
    })

    await put({ name: 'docs', transport: { kind: 'http', url: 'https://a.example.com' } }).expect(
      200,
    )
    await put({
      name: 'docs',
      transport: { kind: 'http', url: 'https://b.example.com' },
      scope: 'group',
      groupId: 'grp-a',
    }).expect(200)
    await put({
      name: 'docs',
      transport: { kind: 'http', url: 'https://c.example.com' },
      scope: 'project',
      projectId: 'prj-1',
    }).expect(200)

    const layered = await trpcQuery({
      app,
      procedure: 'mcpServers.layered',
      token: 'session-a',
      input: { scope: 'project', projectId: 'prj-1' },
    }).expect(200)
    const layers = layered.body.result.data.layers as {
      layer: string
      owner: { id: string | null; name: string }
      items: { name: string; overriddenBy: string | null; transport?: { url: string } }[]
    }[]

    expect(layers.map((layer) => layer.layer)).toEqual(['personal', 'group', 'project', 'repo'])
    expect(layers.map((layer) => layer.owner)).toEqual([
      { id: null, name: 'Personal' },
      { id: 'grp-a', name: 'Comp AI' },
      { id: 'prj-1', name: 'prj-1' },
      { id: null, name: 'repository' },
    ])
    const docs = layers.flatMap((layer) =>
      layer.items
        .filter((item) => item.name === 'docs')
        .map((item) => [layer.layer, item.transport?.url, item.overriddenBy]),
    )
    expect(docs).toEqual([
      ['personal', 'https://a.example.com', 'project'],
      ['group', 'https://b.example.com', 'project'],
      ['project', 'https://c.example.com', null],
    ])
    expect(layers[3]?.items).toMatchObject([{ name: 'from-repo', overriddenBy: null }])
  })
})
