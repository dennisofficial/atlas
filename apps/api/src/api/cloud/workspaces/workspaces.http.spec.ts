import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { encodeSettingValue } from '@dltech/atlas-wire/web'

import request from 'supertest'
import { as, buildSessionApp } from '../session-test-app'
import { seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
import { WorkspaceAccessService } from './workspace-access.service'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'
import { WorkspacesController } from './workspaces.controller'

const ORG = 'org-1'
const base = `/v1/workspaces/${ORG}`

describe('workspaces HTTP surface', () => {
  useTestDatabase()
  let app: INestApplication
  const http = () => request(app.getHttpServer())

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
    app = await buildSessionApp({
      controllers: [WorkspacesController],
      providers: [
        WorkspaceAccessService,
        WorkspaceResourcesService,
        WorkspaceSettingsService,
        WorkspaceVercelService,
      ],
    })
  })

  afterEach(() => app.close())

  it('404s a non-member on reads and writes', async () => {
    const outsider = { ...as('session-a') }
    await db.orm.public.Member.where({ userId: 'user-a' }).deleteAndCount()
    await http().get(`${base}/secrets`).set(outsider).expect(404)
    await http().put(`${base}/secrets/A`).set(outsider).send({ value: 'v' }).expect(404)
    await http().get(`${base}/mcp-servers`).set(outsider).expect(404)
    await http().get(`${base}/settings`).set(outsider).expect(404)
    await http().get('/v1/workspaces/other-org/secrets').set(as('session-b')).expect(404)
  })

  it('lets a member read but forbids a plain member from writing', async () => {
    await http()
      .put(`${base}/secrets/API_KEY`)
      .set(as('session-a'))
      .send({ value: 's' })
      .expect(204)
    const read = await http().get(`${base}/secrets`).set(as('session-b')).expect(200)
    expect(read.body.secrets).toHaveLength(1)

    await http().put(`${base}/secrets/B`).set(as('session-b')).send({ value: 'v' }).expect(403)
    await http().delete(`${base}/secrets/API_KEY`).set(as('session-b')).expect(403)
    await http()
      .put(`${base}/mcp-servers/x`)
      .set(as('session-b'))
      .send({ disabled: true })
      .expect(403)
    await http()
      .patch(`${base}/settings`)
      .set(as('session-b'))
      .send({ values: { 'workspace.defaultModel': encodeSettingValue('m') } })
      .expect(403)
    expect(await db.orm.public.WorkspaceSecret.where((row) => row.id.neq('')).all()).toHaveLength(1)
  })

  it('lets a comma-separated role containing admin write', async () => {
    await http().put(`${base}/secrets/C`).set(as('session-c')).send({ value: 'v' }).expect(204)
  })

  it('joins updatedBy from the user and seals values at rest', async () => {
    await http()
      .put(`${base}/secrets/API_KEY`)
      .set(as('session-a'))
      .send({ value: 'topsecret', kind: 'env' })
      .expect(204)
    expect(
      (await db.orm.public.WorkspaceSecret.where((row) => row.id.neq('')).all())[0]?.sealedValue,
    ).not.toContain('topsecret')

    const read = await http().get(`${base}/secrets`).set(as('session-a')).expect(200)
    expect(read.body.secrets[0]).toMatchObject({
      name: 'API_KEY',
      kind: 'env',
      value: 'topsecret',
      updatedBy: { userId: 'user-a', name: 'Ada' },
    })

    await http()
      .put(`${base}/secrets/bad-name`)
      .set(as('session-a'))
      .send({ value: 'v' })
      .expect(400)
    await http().delete(`${base}/secrets/API_KEY`).set(as('session-a')).expect(204)
    expect(await db.orm.public.WorkspaceSecret.where((row) => row.id.neq('')).all()).toHaveLength(0)
  })

  it('stores workspace MCP servers', async () => {
    await http()
      .put(`${base}/mcp-servers/docs`)
      .set(as('session-a'))
      .send({ transport: { kind: 'stdio', command: 'npx', args: ['docs-mcp'] } })
      .expect(204)
    const read = await http().get(`${base}/mcp-servers`).set(as('session-b')).expect(200)
    expect(read.body.servers[0]).toMatchObject({
      name: 'docs',
      transport: { kind: 'stdio', command: 'npx', args: ['docs-mcp'] },
    })
    await http().delete(`${base}/mcp-servers/docs`).set(as('session-a')).expect(204)
  })

  it('PATCH settings validates against the workspace registry and rejects unknown keys', async () => {
    await http()
      .patch(`${base}/settings`)
      .set(as('session-a'))
      .send({ values: { 'workspace.defaultRegion': encodeSettingValue('fra1') } })
      .expect(204)
    await http()
      .patch(`${base}/settings`)
      .set(as('session-a'))
      .send({ values: { 'workspace.defaultRegion': encodeSettingValue('mars1') } })
      .expect(400)
    await http()
      .patch(`${base}/settings`)
      .set(as('session-a'))
      .send({ values: { 'workspace.nope': encodeSettingValue('x') } })
      .expect(400)
    await http()
      .patch(`${base}/settings`)
      .set(as('session-a'))
      .send({ values: { 'workspace.nope': null } })
      .expect(400)
    await http()
      .patch(`${base}/settings`)
      .set(as('session-a'))
      .send({
        values: {
          'workspace.defaultModel': encodeSettingValue('opus'),
          'model.id': encodeSettingValue('x'),
        },
      })
      .expect(400)

    const read = await http().get(`${base}/settings`).set(as('session-b')).expect(200)
    expect(read.body.settings.map((entry: { key: string }) => entry.key)).toEqual([
      'workspace.defaultRegion',
    ])

    await http()
      .patch(`${base}/settings`)
      .set(as('session-a'))
      .send({ values: { 'workspace.defaultRegion': null } })
      .expect(204)
    expect(await db.orm.public.WorkspaceSetting.where((row) => row.id.neq('')).all()).toHaveLength(
      0,
    )
  })

  it('requires a session', async () => {
    await http().get(`${base}/settings`).expect(401)
  })
})
