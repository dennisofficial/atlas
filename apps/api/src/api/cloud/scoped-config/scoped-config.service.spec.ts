import { ForbiddenException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { beforeEach, describe, expect, it } from 'bun:test'
import { testCipher } from '../session-trpc-test-app'
import { seedProject, seedSessionUsers } from '../web-settings.fake-db'
import { VercelNotConfiguredError } from './scoped-config.errors'
import { ORG, PROJECT, seedAllScopes, setting } from './scoped-config.fixture'
import { ScopedConfigService } from './scoped-config.service'

describe('ScopedConfigService', () => {
  useTestDatabase()
  const cipher = testCipher()
  const scoped = new ScopedConfigService(cipher)

  beforeEach(async () => {
    await seedSessionUsers()
    await seedAllScopes(cipher)
  })

  describe('vercelCredentials owner resolution', () => {
    const workspaceThread = { userId: 'user-a', organizationId: ORG }
    const personalThread = { userId: 'user-a', organizationId: null }
    const gapOf = (gap: EVercelCredentialGap) => ({ gap })

    it('hands a workspace thread the workspace credential and its project id', async () => {
      expect(await scoped.vercelCredentials({ thread: workspaceThread })).toEqual({
        token: 'vtok_workspace',
        teamId: 'team_ws',
        projectId: 'prj_ws',
      })
    })

    it('names CredentialProjectId when the workspace credential has no project id', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).update({
        vercelProjectId: null,
      })
      const failure = scoped.vercelCredentials({ thread: workspaceThread })
      await expect(failure).rejects.toBeInstanceOf(VercelNotConfiguredError)
      await expect(failure).rejects.toMatchObject(gapOf(EVercelCredentialGap.CredentialProjectId))
    })

    it('treats a blank workspace project id as missing', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).update({
        vercelProjectId: '  ',
      })
      await expect(scoped.vercelCredentials({ thread: workspaceThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.CredentialProjectId),
      )
    })

    it('names WorkspaceCredential when the workspace has none', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
      await expect(scoped.vercelCredentials({ thread: workspaceThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.WorkspaceCredential),
      )
    })

    it('refuses a removed member the workspace credential with a 403', async () => {
      const removed = { userId: 'user-b', organizationId: ORG }
      const failure = scoped.vercelCredentials({ thread: removed })
      await expect(failure).rejects.toBeInstanceOf(ForbiddenException)
      await expect(failure).rejects.toMatchObject({ status: 403 })
    })

    it('checks membership before reading the workspace credential', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
      const failure = scoped.vercelCredentials({
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
        await scoped.vercelCredentials({ thread: { userId: 'user-b', organizationId: ORG } }),
      ).toMatchObject({ token: 'vtok_workspace' })
    })

    it('hands a personal thread the creator credential, with or without a personal project', async () => {
      const expected = {
        token: 'vtok_personal',
        teamId: 'team_personal',
        projectId: 'prj_personal',
      }
      expect(await scoped.vercelCredentials({ thread: personalThread })).toEqual(expected)
      await seedProject({ id: 'proj-personal', ownerUserId: 'user-a' })
      await seedThread({ db, id: 'thr-personal', userId: 'user-a', projectId: 'proj-personal' })
      expect(await scoped.vercelCredentials({ thread: personalThread })).toEqual(expected)
    })

    it('names UserCredential when the creator has none, even with a workspace credential', async () => {
      await db.orm.public.UserVercelCredential.where({ userId: 'user-a' }).deleteAndCount()
      await expect(scoped.vercelCredentials({ thread: personalThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.UserCredential),
      )
    })

    it('never falls back from the workspace to the user credential', async () => {
      await db.orm.public.WorkspaceVercelCredential.where({ organizationId: ORG }).deleteAndCount()
      await expect(scoped.vercelCredentials({ thread: workspaceThread })).rejects.toMatchObject(
        gapOf(EVercelCredentialGap.WorkspaceCredential),
      )
    })

    it("reads the creator's own credential, not another member's", async () => {
      await expect(
        scoped.vercelCredentials({ thread: { userId: 'user-b', organizationId: null } }),
      ).rejects.toMatchObject(gapOf(EVercelCredentialGap.UserCredential))
    })
  })

  it('keeps vercel keys for the provisioning resolve only', async () => {
    const full = await scoped.resolveWithProvisioning({ userId: 'user-a', projectId: PROJECT })
    expect(full.settings['sandbox.vercelTeamId']).toBe(setting('team_user'))
    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: PROJECT })
    expect(pod.settings['sandbox.vercelTeamId']).toBeUndefined()
  })
})
