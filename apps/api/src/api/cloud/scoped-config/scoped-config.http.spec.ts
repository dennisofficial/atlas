import { ForbiddenException, type INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { encodeSettingValue, EVercelCredentialGap } from '@dltech/atlas-wire/web'

import request from 'supertest'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sealSecretValue } from '../secrets/sealed-secret'
import { as, buildSessionApp } from '../session-test-app'
import { seedProject, seedSessionUsers, seedWorkspace } from '../web-settings.fake-db'
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
      vercelProjectId: 'prj_ws',
    })
    await db.orm.public.UserVercelCredential.create({
      userId: 'user-a',
      sealedToken: seal('vtok_personal'),
      teamId: 'team_personal',
      vercelProjectId: 'prj_personal',
    })
  }

  beforeEach(async () => {
    await seedSessionUsers()
    app = await buildSessionApp({
      controllers: [ScopedConfigController],
      providers: [ScopedConfigService],
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
    for (const leaked of ['vercel', 'vtok', 'team_', 'prj_']) expect(body).not.toContain(leaked)
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

  describe('vercelCredentials owner resolution', () => {
    const workspaceThread = { userId: 'user-a', organizationId: ORG }
    const personalThread = { userId: 'user-a', organizationId: null }
    const scoped = () => app.get(ScopedConfigService)
    const gapOf = (gap: EVercelCredentialGap) => ({ gap })

    beforeEach(seedAllScopes)

    it('hands a workspace thread the workspace credential and its project id', async () => {
      expect(await scoped().vercelCredentials({ thread: workspaceThread })).toEqual({
        token: 'vtok_workspace',
        teamId: 'team_ws',
        projectId: 'prj_ws',
      })
    })

    it('names CredentialProjectId when the workspace credential has no project id', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).update({
        vercelProjectId: null,
      })
      const failure = scoped().vercelCredentials({ thread: workspaceThread })
      await expect(failure).rejects.toBeInstanceOf(VercelNotConfiguredError)
      await expect(failure).rejects.toMatchObject(gapOf(EVercelCredentialGap.CredentialProjectId))
    })

    it('treats a blank workspace project id as missing', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).update({
        vercelProjectId: '  ',
      })
      await expect(scoped().vercelCredentials({ thread: workspaceThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.CredentialProjectId),
      )
    })

    it('names WorkspaceCredential when the workspace has none', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
      await expect(scoped().vercelCredentials({ thread: workspaceThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.WorkspaceCredential),
      )
    })

    it('refuses a removed member the workspace credential with a 403', async () => {
      const removed = { userId: 'user-b', organizationId: ORG }
      const failure = scoped().vercelCredentials({ thread: removed })
      await expect(failure).rejects.toBeInstanceOf(ForbiddenException)
      await expect(failure).rejects.toMatchObject({ status: 403 })
    })

    it('checks membership before reading the workspace credential', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
      const failure = scoped().vercelCredentials({
        thread: { userId: 'user-b', organizationId: ORG },
      })
      await expect(failure).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('hands a non-owner member the workspace credential', async () => {
      await db.orm.public.Member.create({
        id: 'mem-b',
        organizationId: ORG,
        userId: 'user-b',
        role: 'member',
        createdAt: new Date(),
      })
      expect(
        await scoped().vercelCredentials({ thread: { userId: 'user-b', organizationId: ORG } }),
      ).toMatchObject({ token: 'vtok_workspace' })
    })

    it('hands a personal thread the creator credential, with or without a personal project', async () => {
      const expected = {
        token: 'vtok_personal',
        teamId: 'team_personal',
        projectId: 'prj_personal',
      }
      expect(await scoped().vercelCredentials({ thread: personalThread })).toEqual(expected)
      await seedProject({ id: 'proj-personal', ownerUserId: 'user-a' })
      await seedThread({ db, id: 'thr-personal', userId: 'user-a', projectId: 'proj-personal' })
      expect(await scoped().vercelCredentials({ thread: personalThread })).toEqual(expected)
    })

    it('names UserCredential when the creator has none, even with a workspace credential', async () => {
      await db.orm.public.UserVercelCredential.where({ userId: 'user-a' }).deleteAndCount()
      await expect(scoped().vercelCredentials({ thread: personalThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.UserCredential),
      )
    })

    it('never falls back from the workspace to the user credential', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
      await expect(scoped().vercelCredentials({ thread: workspaceThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.WorkspaceCredential),
      )
    })

    it("reads the creator's own credential, not another member's", async () => {
      await expect(
        scoped().vercelCredentials({ thread: { userId: 'user-b', organizationId: null } }),
      ).rejects.toMatchObject(gapOf(EVercelCredentialGap.UserCredential))
    })
  })

  it('keeps vercel keys for the provisioning resolve only', async () => {
    await seedAllScopes()
    const scoped = app.get(ScopedConfigService)
    const full = await scoped.resolveWithProvisioning({ userId: 'user-a', projectId: PROJECT })
    expect(full.settings['sandbox.vercelTeamId']).toBe(setting('team_user'))
    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: PROJECT })
    expect(pod.settings['sandbox.vercelTeamId']).toBeUndefined()
  })
})
