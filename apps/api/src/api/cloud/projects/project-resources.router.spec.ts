import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { seedSessionUsers } from '../../../test/web-settings.fake-db'
import { buildProjectsApp, createProjectAs, PROJECT_BODY } from './projects.router.fixture'

describe('project resources router', () => {
  useTestDatabase()
  let app: INestApplication

  const create = (body: object) =>
    trpcMutation({ app, path: 'projects.create', token: 'session-a', input: body })
  const update = (input: object) =>
    trpcMutation({ app, path: 'projects.update', token: 'session-a', input })
  const mutate = (args: { path: string; token?: string; input: object }) =>
    trpcMutation({
      app,
      path: `projectResources.${args.path}`,
      token: args.token ?? 'session-a',
      input: args.input,
    })
  const query = (args: { path: string; token?: string; input: object }) =>
    trpcQuery({
      app,
      path: `projectResources.${args.path}`,
      token: args.token ?? 'session-a',
      input: args.input,
    })

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildProjectsApp({})
  })

  afterEach(() => app.close())

  it('creates with description and shipBehavior defaults and leaves them alone on update', async () => {
    const created = await create(PROJECT_BODY).expect(200)
    expect(dataOf(created.body)).toMatchObject({ description: '', shipBehavior: 'open-pr' })
    const projectId = (dataOf(created.body) as { id: string }).id

    const detailed = await update({
      ...PROJECT_BODY,
      projectId,
      description: 'the harness',
      shipBehavior: 'merge',
    }).expect(200)
    expect(dataOf(detailed.body)).toMatchObject({
      description: 'the harness',
      shipBehavior: 'merge',
    })

    const renamed = await update({ ...PROJECT_BODY, projectId, name: 'renamed' }).expect(200)
    expect(dataOf(renamed.body)).toMatchObject({
      description: 'the harness',
      shipBehavior: 'merge',
    })
  })

  it('validates description length and shipBehavior', async () => {
    await create({ ...PROJECT_BODY, description: 'x'.repeat(501) }).expect(400)
    await create({ ...PROJECT_BODY, shipBehavior: 'yolo' }).expect(400)
  })

  it('reads and writes the sandbox, validating vcpus', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    const initial = await query({ path: 'getSandbox', input: { projectId } }).expect(200)
    expect(dataOf(initial.body)).toEqual({ vcpus: null, setupScript: '' })

    const saved = await mutate({
      path: 'saveSandbox',
      input: { projectId, vcpus: 4, setupScript: 'bun install' },
    }).expect(200)
    expect(dataOf(saved.body)).toEqual({ vcpus: 4, setupScript: 'bun install' })

    for (const vcpus of [3, 10, 0]) {
      await mutate({ path: 'saveSandbox', input: { projectId, vcpus, setupScript: '' } }).expect(
        400,
      )
    }
    await mutate({
      path: 'saveSandbox',
      input: { projectId, vcpus: null, setupScript: '' },
    }).expect(200)
  })

  it('stores project secrets, lists no value and enforces env-style names', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    const stored = await mutate({
      path: 'setSecret',
      input: { projectId, name: 'DATABASE_URL', value: 'postgres://x' },
    }).expect(200)
    expect(dataOf(stored.body)).toBeUndefined()
    await mutate({
      path: 'setSecret',
      input: { projectId, name: 'bad-name', value: 'v' },
    }).expect(400)

    const listed = await query({ path: 'listSecrets', input: { projectId } }).expect(200)
    expect(listed.text).not.toContain('postgres://x')
    const [entry] = (dataOf(listed.body) as { secrets: object[] }).secrets
    expect(Object.keys(entry ?? {}).sort()).toEqual(['createdAt', 'name', 'updatedAt'])
    const revealed = await query({
      path: 'revealSecret',
      input: { projectId, name: 'DATABASE_URL' },
    }).expect(200)
    expect(dataOf(revealed.body)).toEqual({ value: 'postgres://x' })
    const stale = await query({
      path: 'revealSecret',
      token: 'stale:session-a',
      input: { projectId, name: 'DATABASE_URL' },
    }).expect(403)
    expect(stale.text).toContain('REAUTH_REQUIRED')
    expect(stale.text).not.toContain('postgres://x')
    expect(
      (await db.orm.public.ProjectSecret.where((row) => row.id.neq('')).all())[0]?.sealedValue,
    ).not.toContain('postgres://x')

    await mutate({ path: 'removeSecret', input: { projectId, name: 'DATABASE_URL' } }).expect(200)
    const after = await query({ path: 'listSecrets', input: { projectId } }).expect(200)
    expect(dataOf(after.body)).toEqual({ secrets: [] })
  })

  it('stores project MCP servers', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await mutate({
      path: 'putMcpServer',
      input: {
        projectId,
        name: 'linear',
        transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
      },
    }).expect(200)
    await mutate({ path: 'putMcpServer', input: { projectId, name: 'broken' } }).expect(400)

    const listed = await query({ path: 'listMcpServers', input: { projectId } }).expect(200)
    expect(dataOf(listed.body)).toMatchObject({
      servers: [
        expect.objectContaining({
          name: 'linear',
          transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
        }),
      ],
    })
    await mutate({ path: 'removeMcpServer', input: { projectId, name: 'linear' } }).expect(200)
  })

  it('answers 404 on every sub-route for a project that is not the caller’s', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    const token = 'session-b'
    await query({ path: 'getSandbox', token, input: { projectId } }).expect(404)
    await mutate({
      path: 'saveSandbox',
      token,
      input: { projectId, vcpus: 2, setupScript: '' },
    }).expect(404)
    await query({ path: 'listSecrets', token, input: { projectId } }).expect(404)
    await mutate({ path: 'setSecret', token, input: { projectId, name: 'A', value: 'v' } }).expect(
      404,
    )
    await query({ path: 'revealSecret', token, input: { projectId, name: 'A' } }).expect(404)
    await mutate({ path: 'removeSecret', token, input: { projectId, name: 'A' } }).expect(404)
    await query({ path: 'listMcpServers', token, input: { projectId } }).expect(404)
    await mutate({
      path: 'putMcpServer',
      token,
      input: { projectId, name: 'x', disabled: true },
    }).expect(404)
    await mutate({ path: 'removeMcpServer', token, input: { projectId, name: 'x' } }).expect(404)
    await query({ path: 'getSandbox', input: { projectId: 'missing' } }).expect(404)
    expect(await db.orm.public.ProjectSecret.where((row) => row.id.neq('')).all()).toHaveLength(0)
    expect(await db.orm.public.ProjectMcpServer.where((row) => row.id.neq('')).all()).toHaveLength(
      0,
    )
  })

  it('rejects an unknown property with 400', async () => {
    const projectId = await createProjectAs({ app, token: 'session-a' })
    await mutate({
      path: 'setSecret',
      input: { projectId, name: 'A', value: 'v', owner: 'user-b' },
    }).expect(400)
  })

  it('requires a session', async () => {
    await trpcQuery({
      app,
      path: 'projectResources.getSandbox',
      input: { projectId: 'p' },
    }).expect(401)
  })
})
