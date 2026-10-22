import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { ensureUsers, seedRepoHook } from '../../../../test/github-seed'
import type { EnvService } from '../../../_core/config/env/env.service'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import type { GithubAppInstallationWebhookPayload } from './github-webhook.types'

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
  useTestDatabase()
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
    await seedRepoHook({ repoFullName: 'trycompai/comp-v2', hookId: 1n, createdBy: 'usr_1' })
    expect(
      await service.shouldRecommend({ userId: 'usr_1', repoFullName: 'trycompai/comp-v2' }),
    ).toBe(false)
  })

  it('stops recommending after dismissal, per user and per repo', async () => {
    await ensureUsers('usr_1', 'usr_2')
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
