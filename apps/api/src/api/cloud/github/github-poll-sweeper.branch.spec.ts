import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  prStateRows,
  seedSubscription as seedSubscriptionRow,
  subscriptionRows,
} from '../../../../test/github-seed'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import {
  fakeHeadReads,
  preparePollSweeper,
  REST_FIELDS,
  REST_PULL,
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

  it('discovers the pull request of a polled branch row through a head target', async () => {
    vi.useFakeTimers()
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

    await service.handlePoll()
    await advanceTimersByTimeAsync(1_100)

    expect(head.pullsByHead).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'ghu_1',
        repoFullName: 'compai/app',
        branch: 'dennis/add-the-thing',
      }),
    )
    expect((await subscriptionRows())[0]?.prNumber).toBeNull()
    const target = await db.orm.public.GithubTrackingTarget.where({
      branch: 'dennis/add-the-thing',
    }).first()
    expect(target?.kind).toBe('head')
    expect(target?.attemptedAt).not.toBeNull()
    expect(target?.nextDueAt.getTime()).toBeGreaterThan(Date.now())
    expect((await prStateRows())[0]).toMatchObject({ prNumber: REST_PULL.number })
  })

  it('keeps a polled branch row unresolved while no pull request carries its head', async () => {
    const head = fakeHeadReads()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

    await service.handlePoll()
    await service.handlePoll()

    expect(head.pullsByHead).toHaveBeenCalledTimes(1)
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
