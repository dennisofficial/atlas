import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../db', async () => {
  const { sharedWebSettingsDb } = await import('../web-settings.fake-db')
  return { db: sharedWebSettingsDb.db }
})

import request from 'supertest'
import { as, buildSessionApp } from '../session-test-app'
import { sharedWebSettingsDb as fake } from '../web-settings.fake-db'
import { WorkspaceAccessService } from './workspace-access.service'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'
import { WorkspacesController } from './workspaces.controller'

const ORG = 'org-1'
const vercel = `/v1/workspaces/${ORG}/vercel`

describe('workspace vercel credential HTTP surface', () => {
  let app: INestApplication
  const http = () => request(app.getHttpServer())

  beforeEach(async () => {
    fake.reset()
    fake.tables.member.rows.push(
      { id: 'm1', organizationId: ORG, userId: 'user-a', role: 'owner' },
      { id: 'm2', organizationId: ORG, userId: 'user-b', role: 'member' },
    )
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

  it('reads unconfigured, saves a sealed token and never returns it', async () => {
    const empty = await http().get(vercel).set(as('session-b')).expect(200)
    expect(empty.body).toEqual({ configured: false, teamId: null, updatedAt: null })

    await http()
      .put(vercel)
      .set(as('session-a'))
      .send({ token: 'vtok_secret', teamId: 'team_1' })
      .expect(204)
    expect(fake.tables.workspaceVercelCredential.rows[0]?.sealedToken).not.toContain('vtok_secret')

    const read = await http().get(vercel).set(as('session-b')).expect(200)
    expect(read.body).toMatchObject({ configured: true, teamId: 'team_1' })
    expect(JSON.stringify(read.body)).not.toContain('vtok')
  })

  it('keeps the token when a later PUT omits it, and needs one the first time', async () => {
    await http().put(vercel).set(as('session-a')).send({ teamId: 'team_1' }).expect(400)
    await http()
      .put(vercel)
      .set(as('session-a'))
      .send({ token: 'vtok_1', teamId: 'team_1' })
      .expect(204)
    const sealed = fake.tables.workspaceVercelCredential.rows[0]?.sealedToken
    await http().put(vercel).set(as('session-a')).send({ teamId: 'team_2' }).expect(204)
    expect(fake.tables.workspaceVercelCredential.rows[0]).toMatchObject({
      teamId: 'team_2',
      sealedToken: sealed,
    })
  })

  it('limits writes to owners and admins, and 404s outsiders', async () => {
    await http().put(vercel).set(as('session-b')).send({ token: 't', teamId: 'x' }).expect(403)
    await http().delete(vercel).set(as('session-b')).expect(403)
    await http().get(vercel).set(as('session-c')).expect(404)
  })

  it('rejects a malformed body and deletes the credential', async () => {
    await http().put(vercel).set(as('session-a')).send({ token: '', teamId: 'team_1' }).expect(400)
    await http().put(vercel).set(as('session-a')).send({ token: 't' }).expect(400)
    await http().put(vercel).set(as('session-a')).send({ token: 't', teamId: 'team_1' }).expect(204)
    await http().delete(vercel).set(as('session-a')).expect(204)
    expect(fake.tables.workspaceVercelCredential.rows).toHaveLength(0)
  })
})
