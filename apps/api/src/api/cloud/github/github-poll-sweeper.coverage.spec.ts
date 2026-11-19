import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import {
  covered,
  fakeHeadReads,
  preparePollSweeper,
  REST_FIELDS,
  REST_PULL,
  seedPrState,
  seedSubscription,
  seedTarget,
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

  it('applies one read of the pull a covered head discovers, then leaves it to the webhook', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
    await covered()
    const target = await seedTarget()

    await service.handlePoll()
    await service.handlePoll()
    await service.handlePoll()

    expect(head.pullsByHead).toHaveBeenCalledTimes(1)
    expect(readPullRequest).toHaveBeenCalledTimes(1)
    const row = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(row?.lookedUpAt).not.toBeNull()
  })

  it('fills the mergeability of a covered pull discovered with no subscription or later webhook', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, mergeable: true }))
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
    await covered()
    await seedTarget()

    await service.handlePoll()
    const discovered = await db.orm.public.GithubPrState.where({
      repoFullName: 'compai/app',
      prNumber: 7,
    }).first()
    expect(discovered?.mergeable).toBeNull()

    await service.handlePoll()

    const filled = await db.orm.public.GithubPrState.where({
      repoFullName: 'compai/app',
      prNumber: 7,
    }).first()
    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect(filled?.mergeable).toBe(true)
    expect(filled?.mergeableObservedAt).not.toBeNull()
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
