import type { INestApplication } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { encodeSettingValue, EVercelCredentialGap } from '@dltech/atlas-wire/web'

mock.module('../../../db', () => ({ db: fake.db }))

import request from 'supertest'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sealSecretValue } from '../secrets/sealed-secret'
import { as, buildSessionApp } from '../session-test-app'
import { sharedWebSettingsDb as fake } from '../web-settings.fake-db'
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
  let app: INestApplication
  let cipher: SecretCipherService
  const http = () => request(app.getHttpServer())
  const seal = (value: string) => sealSecretValue({ cipher, value })

  const seedAllScopes = (): void => {
    fake.tables.project.rows.push({ id: PROJECT, userId: 'user-a', organizationId: ORG })
    fake.tables.thread.rows.push({ id: THREAD, userId: 'user-a', projectId: PROJECT })
    fake.tables.member.rows.push({ id: 'm1', organizationId: ORG, userId: 'user-a', role: 'owner' })
    fake.tables.workspaceSetting.rows.push({ id: 'w1', organizationId: ORG, key: KEY, value: setting('low') })
    fake.tables.cloudSetting.rows.push(
      { id: 'u1', userId: 'user-a', key: KEY, value: setting('medium') },
      { id: 'u2', userId: 'user-a', key: 'sandbox.vercelTeamId', value: setting('team_user') },
    )
    fake.tables.projectSetting.rows.push(
      { id: 'p1', projectId: PROJECT, key: KEY, value: setting('high') },
      { id: 'p2', projectId: PROJECT, key: 'sandbox.vercelProjectId', value: setting('prj_vercel') },
    )
    fake.tables.workspaceSecret.rows.push({ id: 's1', organizationId: ORG, name: 'API', kind: 'secret', sealedValue: seal('ws') })
    fake.tables.secretEntry.rows.push(
      { id: 's2', userId: 'user-a', name: 'API', kind: 'secret', sealedValue: seal('user') },
      { id: 's3', userId: 'user-a', name: 'sandbox.vercelToken', kind: 'secret', sealedValue: seal('vtok_user') },
    )
    fake.tables.projectSecret.rows.push({ id: 's4', projectId: PROJECT, name: 'API', kind: 'env', sealedValue: seal('proj') })
    fake.tables.workspaceVercelCredential.rows.push({
      id: ORG,
      organizationId: ORG,
      sealedToken: seal('vtok_workspace'),
      teamId: 'team_ws',
      updatedAt: new Date(),
    })
  }

  beforeEach(async () => {
    fake.reset()
    app = await buildSessionApp({
      controllers: [ScopedConfigController],
      providers: [ScopedConfigService, WorkspaceVercelService, WorkspaceAccessService],
      sandboxTokens: { [SANDBOX_TOKEN]: { id: 'sbx-1', threadId: THREAD, userId: 'user-a' } },
    })
    cipher = app.get(SecretCipherService)
  })

  afterEach(() => app.close())

  it('lets the project beat user and workspace for one key, and never carries vercel values', async () => {
    seedAllScopes()
    const response = await http().get('/v1/sandboxes/self/config').set(as(SANDBOX_TOKEN)).expect(200)

    expect(response.body.settings).toEqual({ [KEY]: setting('high') })
    expect(response.body.provenance[`setting:${KEY}`]).toBe('project')
    expect(response.body.secrets).toEqual([{ name: 'API', value: 'proj', kind: 'env' }])
    const body = JSON.stringify(response.body)
    for (const leaked of ['vercel', 'vtok', 'team_', 'prj_vercel']) expect(body).not.toContain(leaked)
  })

  it('resolves user + defaults when the thread has no project', async () => {
    fake.tables.thread.rows.push({ id: THREAD, userId: 'user-a', projectId: null })
    fake.tables.cloudSetting.rows.push({ id: 'u1', userId: 'user-a', key: KEY, value: setting('medium') })
    const response = await http().get('/v1/sandboxes/self/config').set(as(SANDBOX_TOKEN)).expect(200)
    expect(response.body.settings).toEqual({ [KEY]: setting('medium') })
    expect(response.body.provenance[`setting:${KEY}`]).toBe('user')
  })

  it('refuses a user session and an unknown token', async () => {
    await http().get('/v1/sandboxes/self/config').set(as('session-a')).expect(403)
    await http().get('/v1/sandboxes/self/config').expect(401)
  })

  it('hands provisioning the workspace credential plus the project id, or names the gap', async () => {
    seedAllScopes()
    const scoped = app.get(ScopedConfigService)
    expect(await scoped.vercelCredentials({ projectId: PROJECT })).toEqual({
      token: 'vtok_workspace',
      teamId: 'team_ws',
      projectId: 'prj_vercel',
    })

    fake.tables.projectSetting.rows.splice(1, 1)
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toMatchObject({
      gap: EVercelCredentialGap.ProjectId,
    })
    fake.tables.workspaceVercelCredential.rows.length = 0
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toMatchObject({
      gap: EVercelCredentialGap.WorkspaceCredential,
    })
    const project = fake.tables.project.rows[0]
    if (project !== undefined) project.organizationId = null
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toBeInstanceOf(VercelNotConfiguredError)
    await expect(scoped.vercelCredentials({ projectId: PROJECT })).rejects.toMatchObject({
      gap: EVercelCredentialGap.ProjectWorkspace,
    })
  })

  it('keeps vercel keys for the provisioning resolve only', async () => {
    seedAllScopes()
    const full = await app.get(ScopedConfigService).resolveWithProvisioning({ userId: 'user-a', projectId: PROJECT })
    expect(full.settings['sandbox.vercelProjectId']).toBe(setting('prj_vercel'))
  })
})
