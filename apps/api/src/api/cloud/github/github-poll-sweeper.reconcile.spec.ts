import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { prEventRows } from '../../../../test/github-seed'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService post-merge reconciliation', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('keeps polling a merged PR whose head still owes a verdict, inside the window', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      state: 'merged',
      checksRunning: 0,
      checksPassed: 8,
      checksFailed: 0,
    }))
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({
      state: 'merged',
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      updatedAt: new Date(),
    })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalled()
    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green', settled: true } })
  })

  it('drops a merged PR whose verdict obligation is already discharged', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, state: 'merged' }))
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({
      state: 'merged',
      checksRunning: 0,
      checksPassed: 8,
      checksFailed: 0,
      updatedAt: new Date(),
    })
    await db.orm.public.GithubPrHeadCheck.create({
      repoFullName: 'compai/app',
      prNumber: 42,
      headSha: 'abc123',
      settledAt: new Date(),
      verdict: 'green',
      verdictEventId: 'compai/app:42:abc123:verdict:green',
    })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prEventRows()).toHaveLength(0)
  })

  it('drops a merged PR with an unsettled head once the window has passed', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, state: 'merged' }))
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({
      state: 'merged',
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      updatedAt: new Date(Date.now() - 31 * 60 * 1_000),
    })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prEventRows()).toHaveLength(0)
  })

  it('announces a settled verdict on a poll that first observes an already-green head', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
    }))
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription()

    await service.handlePoll()

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr_1',
      payload: { verdict: 'green', settled: true },
    })
  })
})
