import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'

const STALE = () => new Date(Date.now() - 60 * 60_000)

describe('GithubPollSweeperService webhook coverage', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('never timer-polls a repository the GitHub App covers', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await db.orm.public.GithubAppInstallation.create({
      installationId: 11n,
      accountLogin: 'compai',
      accountType: 'Organization',
      repos: ['compai/app'],
      suspendedAt: null,
    })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: STALE() })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('never timer-polls a repository with a live webhook of its own', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedRepoHook({ repoFullName: 'compai/app', hookId: 12n })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: STALE() })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('still polls a repository no webhook reaches', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: STALE() })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledTimes(1)
  })
})
