import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedSubscription as seedSubscriptionRow } from '../../../../test/github-seed'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'
import { GithubUserReadFailed } from './github-user-reads'

describe('GithubPollSweeperService hook-backed re-anchor restraint', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('never re-anchors a subscription whose PR is already merged', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ state: 'merged', updatedAt: new Date(Date.now() - 60 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('never re-anchors a subscription whose PR is closed', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ state: 'closed', updatedAt: new Date(Date.now() - 60 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('polls a distinct PR once per sweep no matter how many rows subscribe to it', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1', usr_2: 'ghu_2' },
      readPullRequest,
    })
    await seedSubscription({ id: 'sub-1', pollBacked: false })
    await seedSubscriptionRow({ id: 'sub-2', userId: 'usr_2', pollBacked: false })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledTimes(1)
  })

  it('aborts the hook-backed pass when GitHub answers rate-limited', async () => {
    const readPullRequest = vi.fn(async ({ number }: { number: number }) => {
      if (number === 42) throw new GithubUserReadFailed('rate limit exceeded', 429)
      return REST_FIELDS
    })
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1', usr_2: 'ghu_2' },
      readPullRequest,
    })
    await seedSubscription({ id: 'sub-1', pollBacked: false })
    await seedSubscriptionRow({ id: 'sub-2', userId: 'usr_2', pollBacked: false, prNumber: 43 })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps sweeping past a non-rate-limit read failure', async () => {
    const readPullRequest = vi.fn(async ({ number }: { number: number }) => {
      if (number === 42) throw new GithubUserReadFailed('bad credentials', 401)
      return REST_FIELDS
    })
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1', usr_2: 'ghu_2' },
      readPullRequest,
    })
    await seedSubscription({ id: 'sub-1', pollBacked: false })
    await seedSubscriptionRow({ id: 'sub-2', userId: 'usr_2', pollBacked: false, prNumber: 43 })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledTimes(2)
  })
})
