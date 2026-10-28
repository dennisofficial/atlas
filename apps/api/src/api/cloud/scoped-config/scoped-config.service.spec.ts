import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import { testCipher } from '../session-trpc-test-app'
import { seedProject, seedSessionUsers } from '../web-settings.fake-db'
import { VercelNotConfiguredError } from './scoped-config.errors'
import { PROJECT, seedAllScopes, setting } from './scoped-config.fixture'
import { ScopedConfigService } from './scoped-config.service'

describe('ScopedConfigService', () => {
  useTestDatabase()
  const cipher = testCipher()
  const scoped = new ScopedConfigService(cipher)

  beforeEach(async () => {
    await seedSessionUsers()
    await seedAllScopes(cipher)
  })

  describe('vercelCredentials', () => {
    it("hands the thread owner's own credential, team and project id", async () => {
      expect(await scoped.vercelCredentials({ thread: { userId: 'user-a' } })).toEqual({
        token: 'vtok_personal',
        teamId: 'team_personal',
        projectId: 'prj_personal',
      })
    })

    it('names UserCredential when the owner has none', async () => {
      const failure = scoped.vercelCredentials({ thread: { userId: 'user-b' } })
      await expect(failure).rejects.toBeInstanceOf(VercelNotConfiguredError)
      await expect(failure).rejects.toMatchObject({ gap: EVercelCredentialGap.UserCredential })
    })

    it('names UserCredential after the owner removes theirs', async () => {
      await db.orm.public.UserVercelCredential.where({ userId: 'user-a' }).deleteAndCount()
      await expect(
        scoped.vercelCredentials({ thread: { userId: 'user-a' } }),
      ).rejects.toMatchObject({ gap: EVercelCredentialGap.UserCredential })
    })
  })

  describe('accessibleProject', () => {
    it('returns an owned project', async () => {
      expect(await scoped.accessibleProject({ userId: 'user-a', projectId: PROJECT })).toBe(PROJECT)
    })

    it("hides another user's project as not found", async () => {
      await expect(
        scoped.accessibleProject({ userId: 'user-b', projectId: PROJECT }),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('hides a missing project as not found', async () => {
      await seedProject({ id: 'proj-other', ownerUserId: 'user-b' })
      await expect(
        scoped.accessibleProject({ userId: 'user-a', projectId: 'proj-other' }),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  it('keeps vercel keys for the provisioning resolve only', async () => {
    const full = await scoped.resolveWithProvisioning({ userId: 'user-a', projectId: PROJECT })
    expect(full.settings['sandbox.vercelTeamId']).toBe(setting('team_user'))
    const pod = await scoped.resolveForPod({ userId: 'user-a', projectId: PROJECT })
    expect(pod.settings['sandbox.vercelTeamId']).toBeUndefined()
  })
})
