import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubCallSource } from '@dltech/atlas-github'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { repoHookRows, seedRepoHook } from '../../../../test/github-seed'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedSubscription,
  serviceWith,
} from './github-poll-sweeper.fixture'

describe('GithubPollSweeperService hook idling', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('marks a hook idle once its last live subscription expires', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedRepoHook({ createdBy: 'usr_1' })
    await seedSubscription({
      pollBacked: false,
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() - 60_000),
    })

    await service.handlePoll()

    expect((await repoHookRows())[0]?.idleSince).not.toBeNull()
  })

  it('keeps a hook active while any subscription is live', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedRepoHook({ createdBy: 'usr_1' })
    await seedSubscription({ pollBacked: false })

    await service.handlePoll()

    expect((await repoHookRows())[0]?.idleSince).toBeNull()
  })
})

describe('GithubPollSweeperService parked-subscription survival', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('polls an expired subscription whose liveUntil covers the wake window', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({
      id: 'sub-parked',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      threadId: 'thr_1',
    })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledWith({
      source: EGithubCallSource.PollSweep,
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      number: 7,
    })
  })

  it('skips an expired subscription whose liveUntil has passed', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedSubscription({
      id: 'sub-stale',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() - 60_000),
      threadId: 'thr_1',
    })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })
})
