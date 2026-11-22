import { useTestDatabase } from '@dltech/atlas-db/testing'
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import { testCipher } from '../session-trpc-test-app'
import { seedProject, seedSessionUsers } from '../../../test/web-settings.fake-db'
import {
  envWith,
  platformEnv,
  PLATFORM_VERCEL_ENV,
  PROJECT,
  seedAllScopes,
  setting,
} from './scoped-config.fixture'
import { NOT_CONFIGURED_MESSAGE, ScopedConfigService } from './scoped-config.service'

describe('ScopedConfigService', () => {
  useTestDatabase()
  const cipher = testCipher()
  const scoped = new ScopedConfigService(cipher, platformEnv())

  beforeEach(async () => {
    await seedSessionUsers()
    await seedAllScopes(cipher)
  })

  describe('vercelCredentials', () => {
    it('hands the platform account that provisions every sandbox', async () => {
      expect(await scoped.vercelCredentials()).toEqual({
        token: 'plat-token',
        teamId: 'plat-team',
        projectId: 'plat-prj',
      })
    })

    it('answers 503 when the deployment carries no platform account', async () => {
      const unconfigured = new ScopedConfigService(cipher, envWith({}))
      const read = unconfigured.vercelCredentials()
      await expect(read).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(read).rejects.toThrow(NOT_CONFIGURED_MESSAGE)
    })

    it('answers 503 when the platform account is only half configured', async () => {
      const unconfigured = new ScopedConfigService(
        cipher,
        envWith({ PLATFORM_VERCEL_TOKEN: PLATFORM_VERCEL_ENV.PLATFORM_VERCEL_TOKEN }),
      )
      await expect(unconfigured.vercelCredentials()).rejects.toThrow(NOT_CONFIGURED_MESSAGE)
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
