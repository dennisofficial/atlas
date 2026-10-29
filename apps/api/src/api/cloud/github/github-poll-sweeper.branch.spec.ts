import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubCallSource } from './github-call-log'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  prStateRows,
  seedSubscription as seedSubscriptionRow,
  subscriptionRows,
} from '../../../../test/github-seed'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService branch subscriptions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('skips a hook-backed branch row with no pr number — webhooks route it by branch', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const findOpenPrForBranch = vi.fn(async () => ({ number: 42 }))
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      readPullRequest,
      findOpenPrForBranch,
    })
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing', pollBacked: false })

    await service.handlePoll()

    expect(findOpenPrForBranch).not.toHaveBeenCalled()
    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('re-resolves a poll-backed branch row with no pr number and records the found pr', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const findOpenPrForBranch = vi.fn(async () => ({ number: 42 }))
    const { service, fanout } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      readPullRequest,
      findOpenPrForBranch,
    })
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr_1', handler: (state) => received.push(state) })

    await service.handlePoll()
    await advanceTimersByTimeAsync(1_100)

    expect(findOpenPrForBranch).toHaveBeenCalledWith({
      source: EGithubCallSource.PollSweep,
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      branch: 'dennis/add-the-thing',
    })
    expect((await subscriptionRows())[0]?.prNumber).toBe(42)
    expect(readPullRequest).toHaveBeenCalledWith({
      source: EGithubCallSource.PollSweep,
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42 })
    expect(received).toHaveLength(1)
  })

  it('leaves a poll-backed branch row unresolved while no open pr exists for it', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const findOpenPrForBranch = vi.fn(async () => null)
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      readPullRequest,
      findOpenPrForBranch,
    })
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

    await service.handlePoll()

    expect(findOpenPrForBranch).toHaveBeenCalled()
    expect(readPullRequest).not.toHaveBeenCalled()
    expect((await subscriptionRows())[0]?.prNumber).toBeNull()
    expect(await prStateRows()).toHaveLength(0)
  })

  it('a poll for a known pr reaches a branch subscriber of the same repo', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { usr_1: 'ghu_1' } })
    await seedSubscription()
    await seedSubscriptionRow({
      id: 'sub-branch',
      userId: 'usr_2',
      prNumber: null,
      branch: 'dennis/add-the-thing',
    })

    const pushes = vi.spyOn(fanout, 'push')

    await service.handlePoll()
    await advanceTimersByTimeAsync(1_100)

    expect(pushes).toHaveBeenCalled()
    expect([...pushes.mock.calls[0]![0].userIds].sort()).toEqual(['usr_1', 'usr_2'])
  })
})
