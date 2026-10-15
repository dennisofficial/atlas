import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { EnvService } from '../../../_core/config/env/env.service'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import type { GithubAppInstallationWebhookPayload } from './github-webhook.types'

const fake = fakeGithubDb()
const ENV = {
  get: (key: string) => (key === 'GITHUB_APP_SLUG' ? 'atlas-by-dl' : undefined),
} as unknown as EnvService

const installations = new GithubAppInstallationsService()
const service = new GithubAppInstallNoticeService(installations, ENV)

function seedAppCovering(repoFullName: string): Promise<void> {
  const payload: GithubAppInstallationWebhookPayload = {
    action: 'created',
    installation: { id: 1001, account: { login: 'trycompai', type: 'Organization' }, suspended_at: null },
    repositories: [{ full_name: repoFullName }],
  }
  return installations.applyInstallation(payload)
}

describe('GithubAppInstallNoticeService', () => {
  beforeEach(() => fake.reset())

  it('recommends for an uncovered, hook-less, undismissed repo', async () => {
    expect(
      await service.shouldRecommend({ userId: 'usr_1', repoFullName: 'trycompai/comp-v2' }),
    ).toBe(true)
  })

  it('does not recommend once the repo is covered by the app', async () => {
    await seedAppCovering('trycompai/comp-v2')
    expect(
      await service.shouldRecommend({ userId: 'usr_1', repoFullName: 'trycompai/comp-v2' }),
    ).toBe(false)
  })

  it('does not recommend when a personal hook exists for the repo', async () => {
    fake.repoHooks.push({
      repoFullName: 'trycompai/comp-v2',
      hookId: 1n,
      secret: 'sealed',
      createdBy: 'usr_1',
      status: 'active',
      idleSince: null,
      sweepLeaseUntil: null,
      createdAt: new Date(),
    })
    expect(
      await service.shouldRecommend({ userId: 'usr_1', repoFullName: 'trycompai/comp-v2' }),
    ).toBe(false)
  })

  it('stops recommending after dismissal, per user and per repo', async () => {
    await service.dismiss({ userId: 'usr_1', repoFullName: 'trycompai/comp-v2' })
    expect(
      await service.shouldRecommend({ userId: 'usr_1', repoFullName: 'trycompai/comp-v2' }),
    ).toBe(false)
    expect(
      await service.shouldRecommend({ userId: 'usr_2', repoFullName: 'trycompai/comp-v2' }),
    ).toBe(true)
    expect(await service.shouldRecommend({ userId: 'usr_1', repoFullName: 'other/repo' })).toBe(true)
  })

  it('builds the install url from the configured slug', () => {
    expect(service.installUrl()).toBe('https://github.com/apps/atlas-by-dl/installations/new')
  })

  it('returns no install url when the slug is not configured', () => {
    const noSlug = new GithubAppInstallNoticeService(installations, {
      get: () => undefined,
    } as unknown as EnvService)
    expect(noSlug.installUrl()).toBeNull()
  })
})
