import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { encodeSettingValue, EVercelCredentialGap } from '@dltech/atlas-wire/web'

import request from 'supertest'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sealSecretValue } from '../secrets/sealed-secret'
import { as, buildSessionApp } from '../session-test-app'
import { seedProject, seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'
import { WorkspaceVercelService } from '../workspaces/workspace-vercel.service'
import { ScopedConfigController } from './scoped-config.controller'
import { VercelNotConfiguredError } from './scoped-config.errors'
import { ScopedConfigService } from './scoped-config.service'

const ORG = 'org-1'
const PROJECT = 'proj-1'
const THREAD = 'thr-1'
const SANDBOX_TOKEN = 'sbx-token'
const KEY = 'model.effort'

const setting = (value: string) => encodeSettingValue(value)

describe('GET /v1/sandboxes/self/config', () => {
  useTestDatabase()
  let app: INestApplication
  let cipher: SecretCipherService
  const http = () => request(app.getHttpServer())
  const seal = (value: string) => sealSecretValue({ cipher, value })

  const seedAllScopes = async (): Promise<void> => {
    await seedWorkspace({ id: ORG, members: [{ userId: 'user-a', role: 'owner' }] })
    await seedProject({ id: PROJECT, ownerUserId: 'user-a', organizationId: ORG })
    await seedThread({ db, id: THREAD, userId: 'user-a', projectId: PROJECT })
    await db.orm.public.WorkspaceSetting.create({
      id: 'w1',
      organizationId: ORG,
      key: KEY,
      value: setting('low'),
    })
    await db.orm.public.UserSetting.createAll([
      { id: 'u1', userId: 'user-a', key: KEY, value: setting('medium') },
      { id: 'u2', userId: 'user-a', key: 'sandbox.vercelTeamId', value: setting('team_user') },
    ])
    await db.orm.public.ProjectSetting.createAll([
      { id: 'p1', projectId: PROJECT, key: KEY, value: setting('high') },
      {
        id: 'p2',
        projectId: PROJECT,
        key: 'sandbox.vercelProjectId',
        value: setting('prj_vercel'),
      },
    ])
    await db.orm.public.WorkspaceSecret.create({
      id: 's1',
      organizationId: ORG,
      name: 'API',
      kind: 'secret',
      sealedValue: seal('ws'),
    })
    await db.orm.public.UserSecret.createAll([
      { id: 's2', userId: 'user-a', name: 'API', kind: 'secret', sealedValue: seal('user') },
      {
        id: 's3',
        userId: 'user-a',
        name: 'sandbox.vercelToken',
        kind: 'secret',
        sealedValue: seal('vtok_user'),
      },
    ])
    await db.orm.public.ProjectSecret.create({
      id: 's4',
      projectId: PROJECT,
      name: 'API',
      kind: 'env',
      sealedValue: seal('proj'),
    })
    await db.orm.public.WorkspaceVercelCredential.create({
      organizationId: ORG,
      sealedToken: seal('vtok_workspace'),
      teamId: 'team_ws',
    })
  }

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildSessionApp({
      controllers: [ScopedConfigController],
      providers: [ScopedConfigService, WorkspaceVercelService, WorkspaceAccessService],
      sandboxTokens: { [SANDBOX_TOKEN]: { id: 'sbx-1', threadId: THREAD, userId: 'user-a' } },
    })
    cipher = app.get(SecretCipherService)
  })

  afterEach(() => app.close())

  it('lets the project beat user and workspace for one key, and never carries vercel values', async () => {
    await seedAllScopes()
    const response = await http()
      .get('/v1/sandboxes/self/config')
      .set(as(SANDBOX_TOKEN))
      .expect(200)

    expect(response.body.settings).toEqual({ [KEY]: setting('high') })
    expect(response.body.provenance[`setting:${KEY}`]).toBe('project')
    expect(response.body.secrets).toEqual([{ name: 'API', value: 'proj', kind: 'env' }])
    const body = JSON.stringify(response.body)
    for (const leaked of ['vercel', 'vtok', 'team_', 'prj_vercel'])
      expect(body).not.toContain(leaked)
  })

  it('resolves user + defaults when the thread has no project', async () => {
    await seedThread({ db, id: THREAD, userId: 'user-a' })
    await db.orm.public.UserSetting.create({
      id: 'u1',
      userId: 'user-a',
      key: KEY,
      value: setting('medium'),
    })
    const response = await http()
      .get('/v1/sandboxes/self/config')
      .set(as(SANDBOX_TOKEN))
      .expect(200)
    expect(response.body.settings).toEqual({ [KEY]: setting('medium') })
    expect(response.body.provenance[`setting:${KEY}`]).toBe('user')
  })

  it('refuses a user session and an unknown token', async () => {
    await http().get('/v1/sandboxes/self/config').set(as('session-a')).expect(403)
    await http().get('/v1/sandboxes/self/config').expect(401)
  })

  it('hands provisioning the workspace credential plus the project id, or names the gap', async () => {
    await seedAllScopes()
    const scoped = app.get(ScopedConfigService)
    expect(await scoped.vercelCredentials({ projectId: PROJECT })).toEqual({
      token: 'vtok_workspace',
      teamId: 'team_ws',
      projectId: 'prj_vercel',
    })

    await db.orm.public.ProjectSetting.where({ id: 'p2' }).deleteAndCount()
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toMatchObject({
      gap: EVercelCredentialGap.ProjectId,
    })
    await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toMatchObject({
      gap: EVercelCredentialGap.WorkspaceCredential,
    })
    await db.orm.public.Project.where({ id: PROJECT }).update({
      organizationId: null,
      ownerUserId: 'user-a',
    })
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toBeInstanceOf(
      VercelNotConfiguredError,
    )
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toMatchObject({
      gap: EVercelCredentialGap.ProjectWorkspace,
    })
  })

  it('keeps vercel keys for the provisioning resolve only', async () => {
    await seedAllScopes()
    const full = await app
      .get(ScopedConfigService)
      .resolveWithProvisioning({ userId: 'user-a', projectId: PROJECT })
    expect(full.settings['sandbox.vercelProjectId']).toBe(setting('prj_vercel'))
  })
})
