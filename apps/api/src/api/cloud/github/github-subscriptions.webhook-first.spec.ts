import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { ensureUsers, prStateRows, seedPrState } from '../../../../test/github-seed'
import { GithubHttpBudgetUnavailable } from './github-request-budget'
import { REST_FIELDS } from './github-poll-sweeper.fixture'
import { serviceWith } from './github-subscriptions.fixture'

const cover = (repoFullName: string) =>
  db.orm.public.GithubAppInstallation.create({
    installationId: 21n,
    accountLogin: repoFullName.split('/')[0] ?? 'compai',
    accountType: 'Organization',
    repos: [repoFullName],
    suspendedAt: null,
  })

describe('GithubSubscriptionsService without a GitHub pull request read', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  afterEach(() => unstubAllGlobals())

  it('answers from the webhook-maintained state instead of reading the pull request again', async () => {
    await cover('compai/app')
    await seedPrState({ checksPassed: 2, mergeable: true, updatedAt: new Date() })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const service = serviceWith({ token: 'ghu_1', readPullRequest })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(dto.state?.prNumber).toBe(42)
    expect(dto.state?.checksPassed).toBe(2)
  })

  it('answers with the state it already holds when the budget refuses the read', async () => {
    await seedPrState({
      checksPassed: 2,
      mergeable: true,
      updatedAt: new Date(Date.now() - 60 * 60_000),
    })
    const readPullRequest = vi.fn(async () => {
      throw new GithubHttpBudgetUnavailable()
    })
    const service = serviceWith({ token: 'ghu_1', readPullRequest })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect(dto.state?.prNumber).toBe(42)
    expect(await prStateRows()).toHaveLength(1)
  })

  it('reads once when nothing has recorded the pull request yet', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const service = serviceWith({ token: 'ghu_1', readPullRequest })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect(dto.state?.prNumber).toBe(42)
  })
})
