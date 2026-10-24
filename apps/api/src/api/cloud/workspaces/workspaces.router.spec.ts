import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { encodeSettingValue } from '@dltech/atlas-wire/web'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
import { buildWorkspacesApp, ORG } from './workspaces.router.fixture'

describe('workspaces router', () => {
  useTestDatabase()
  let app: INestApplication

  const query = (args: { path: string; token?: string; organizationId?: string }) =>
    trpcQuery({
      app,
      path: `workspaces.${args.path}`,
      token: args.token ?? 'session-a',
      input: { organizationId: args.organizationId ?? ORG },
    })
  const mutate = (args: { path: string; token?: string; input: object }) =>
    trpcMutation({
      app,
      path: `workspaces.${args.path}`,
      token: args.token ?? 'session-a',
      input: { organizationId: ORG, ...args.input },
    })
  const setSecret = (args: { name: string; value: string; kind?: string; token?: string }) =>
    mutate({
      path: 'setSecret',
      token: args.token ?? 'session-a',
      input: { name: args.name, value: args.value, kind: args.kind },
    })
  const patch = (args: { values: object; token?: string }) =>
    mutate({
      path: 'patchSettings',
      token: args.token ?? 'session-a',
      input: { values: args.values },
    })

  beforeEach(async () => {
    await seedSessionUsers()
    await db.orm.public.User.where({ id: 'user-a' }).update({ name: 'Ada' })
    await seedWorkspace({
      id: ORG,
      members: [
        { userId: 'user-a', role: 'owner' },
        { userId: 'user-b', role: 'member' },
        { userId: 'user-c', role: 'member,admin' },
      ],
    })
    app = await buildWorkspacesApp()
  })

  afterEach(() => app.close())

  it('404s a non-member on reads and writes', async () => {
    await db.orm.public.Member.where({ userId: 'user-a' }).deleteAndCount()
    await query({ path: 'listSecrets' }).expect(404)
    await setSecret({ name: 'A', value: 'v' }).expect(404)
    await query({ path: 'listMcpServers' }).expect(404)
    await query({ path: 'listSettings' }).expect(404)
    await query({ path: 'listSecrets', token: 'session-b', organizationId: 'other-org' }).expect(
      404,
    )
  })

  it('lets a member read but forbids a plain member from writing', async () => {
    await setSecret({ name: 'API_KEY', value: 's' }).expect(200)
    const read = await query({ path: 'listSecrets', token: 'session-b' }).expect(200)
    expect(dataOf(read.body)).toMatchObject({ secrets: [expect.anything()] })

    await setSecret({ name: 'B', value: 'v', token: 'session-b' }).expect(403)
    await mutate({
      path: 'removeSecret',
      token: 'session-b',
      input: { name: 'API_KEY' },
    }).expect(403)
    await mutate({
      path: 'putMcpServer',
      token: 'session-b',
      input: { name: 'x', disabled: true },
    }).expect(403)
    await patch({
      token: 'session-b',
      values: { 'workspace.defaultModel': encodeSettingValue('m') },
    }).expect(403)
    expect(await db.orm.public.WorkspaceSecret.where((row) => row.id.neq('')).all()).toHaveLength(1)
  })

  it('lets a comma-separated role containing admin write', async () => {
    await setSecret({ name: 'C', value: 'v', token: 'session-c' }).expect(200)
  })

  it('joins updatedBy from the user and seals values at rest', async () => {
    await setSecret({ name: 'API_KEY', value: 'topsecret', kind: 'env' }).expect(200)
    expect(
      (await db.orm.public.WorkspaceSecret.where((row) => row.id.neq('')).all())[0]?.sealedValue,
    ).not.toContain('topsecret')

    const read = await query({ path: 'listSecrets' }).expect(200)
    const { secrets } = dataOf(read.body) as { secrets: object[] }
    expect(secrets[0]).toMatchObject({
      name: 'API_KEY',
      kind: 'env',
      value: 'topsecret',
      updatedBy: { userId: 'user-a', name: 'Ada' },
    })

    await setSecret({ name: 'bad-name', value: 'v' }).expect(400)
    await mutate({ path: 'removeSecret', input: { name: 'API_KEY' } }).expect(200)
    expect(await db.orm.public.WorkspaceSecret.where((row) => row.id.neq('')).all()).toHaveLength(0)
  })

  it('stores workspace MCP servers', async () => {
    await mutate({
      path: 'putMcpServer',
      input: { name: 'docs', transport: { kind: 'stdio', command: 'npx', args: ['docs-mcp'] } },
    }).expect(200)
    const read = await query({ path: 'listMcpServers', token: 'session-b' }).expect(200)
    const { servers } = dataOf(read.body) as { servers: object[] }
    expect(servers[0]).toMatchObject({
      name: 'docs',
      transport: { kind: 'stdio', command: 'npx', args: ['docs-mcp'] },
    })
    await mutate({ path: 'removeMcpServer', input: { name: 'docs' } }).expect(200)
  })

  it('patchSettings validates against the workspace registry and rejects unknown keys', async () => {
    await patch({ values: { 'workspace.defaultRegion': encodeSettingValue('fra1') } }).expect(200)
    await patch({ values: { 'workspace.defaultRegion': encodeSettingValue('mars1') } }).expect(400)
    await patch({ values: { 'workspace.nope': encodeSettingValue('x') } }).expect(400)
    await patch({ values: { 'workspace.nope': null } }).expect(400)
    await patch({
      values: {
        'workspace.defaultModel': encodeSettingValue('opus'),
        'model.id': encodeSettingValue('x'),
      },
    }).expect(400)

    const read = await query({ path: 'listSettings', token: 'session-b' }).expect(200)
    const { settings } = dataOf(read.body) as { settings: { key: string }[] }
    expect(settings.map((entry) => entry.key)).toEqual(['workspace.defaultRegion'])

    await patch({ values: { 'workspace.defaultRegion': null } }).expect(200)
    expect(await db.orm.public.WorkspaceSetting.where((row) => row.id.neq('')).all()).toHaveLength(
      0,
    )
  })

  it('rejects an unknown property with 400', async () => {
    await mutate({ path: 'setSecret', input: { name: 'A', value: 'v', extra: 1 } }).expect(400)
  })

  it('requires a session', async () => {
    await trpcQuery({
      app,
      path: 'workspaces.listSettings',
      input: { organizationId: ORG },
    }).expect(401)
  })
})
