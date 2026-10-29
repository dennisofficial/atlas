import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubCallSource } from './github-call-log'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows } from '../../../../test/github-seed'
import { advanceTimersByTimeAsync } from '../../../../test/fake-timers'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'
import { GithubUserReadFailed } from './github-user-reads'

describe('GithubPollSweeperService polling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('polls a live poll-backed subscription as its user and pushes the diff', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription()

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr_1', handler: (state) => received.push(state) })

    await service.handlePoll()
    await advanceTimersByTimeAsync(1_100)

    expect(readPullRequest).toHaveBeenCalledWith({
      source: EGithubCallSource.PollSweep,
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect((await prStateRows())[0]).toMatchObject({
      prNumber: 42,
      checksFailed: 1,
      mergeable: false,
    })
    expect(received).toHaveLength(1)
  })

  it('skips expired subscriptions', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({
      id: 'sub-2',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() - 60_000),
    })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('re-anchors a hook-backed subscription whose state row is missing', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr_1', handler: (state) => received.push(state) })

    await service.handlePoll()
    await advanceTimersByTimeAsync(1_100)

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

  it('re-anchors a hook-backed subscription whose state row has gone quiet', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: new Date(Date.now() - 11 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalled()
  })

  it('leaves a hook-backed subscription alone while webhooks keep its state row fresh', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: new Date(Date.now() - 2 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('skips a subscription whose owner has no token', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    await seedSubscription()

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prStateRows()).toHaveLength(0)
  })

  it('tolerates a rejected token without failing the sweep', async () => {
    const readPullRequest = vi.fn(async () => {
      throw new GithubUserReadFailed('bad credentials', 401)
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_dead' }, readPullRequest })
    await seedSubscription()

    await expect(service.handlePoll()).resolves.toBeUndefined()
    expect(await prStateRows()).toHaveLength(0)
  })
})
