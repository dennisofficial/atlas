import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubUserReads } from './github-user-reads'
import { GithubUserReadFailed } from './github-user-reads'
import type { GithubService } from './github.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'

const fake = fakeGithubDb()

const REST_FIELDS: PullRequestCacheFields = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 1,
  mergeable: false,
  mergeableState: 'dirty',
}

function serviceWith(args: {
  tokens?: Record<string, string>
  readPullRequest?: GithubUserReads['readPullRequest']
}): { service: GithubPollSweeperService; fanout: GithubPrFanoutService } {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService()
  return { service: new GithubPollSweeperService(github, reads, fanout), fanout }
}

function seedSubscription(overrides: Partial<(typeof fake.subscriptions)[number]> = {}): void {
  fake.subscriptions.push({
    id: 'sub-1',
    userId: 'usr_1',
    repoFullName: 'compai/app',
    prNumber: 42,
    pollBacked: true,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  })
}

describe('GithubPollSweeperService', () => {
  beforeEach(() => {
    fake.reset()
    vi.useRealTimers()
  })

  it('polls a live poll-backed subscription as its user and pushes the diff', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedSubscription()

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr_1', handler: (state) => received.push(state) })

    await service.handlePoll()
    await vi.advanceTimersByTimeAsync(1_100)

    expect(readPullRequest).toHaveBeenCalledWith({
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect(fake.prStates[0]).toMatchObject({ prNumber: 42, checksFailed: 1, mergeable: false })
    expect(received).toHaveLength(1)
  })

  it('skips hook-backed and expired subscriptions', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedSubscription({ pollBacked: false })
    seedSubscription({ id: 'sub-2', prNumber: 7, expiresAt: new Date(Date.now() - 60_000) })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('skips a subscription whose owner has no token', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    seedSubscription()

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.prStates).toHaveLength(0)
  })

  it('tolerates a rejected token without failing the sweep', async () => {
    const readPullRequest = vi.fn(async () => {
      throw new GithubUserReadFailed('bad credentials', 401)
    })
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_dead' }, readPullRequest })
    seedSubscription()

    await expect(service.handlePoll()).resolves.toBeUndefined()
    expect(fake.prStates).toHaveLength(0)
  })

  it('marks a hook idle once its last live subscription expires', async () => {
    const { service } = serviceWith({ tokens: {} })
    fake.repoHooks.push({
      repoFullName: 'compai/app',
      hookId: 101n,
      secret: 'sealed',
      createdBy: 'usr_1',
      status: 'active',
      idleSince: null,
      sweepLeaseUntil: null,
      createdAt: new Date(),
    })
    seedSubscription({ pollBacked: false, expiresAt: new Date(Date.now() - 60_000) })

    await service.handlePoll()

    expect(fake.repoHooks[0]?.idleSince).not.toBeNull()
  })

  it('keeps a hook active while any subscription is live', async () => {
    const { service } = serviceWith({ tokens: {} })
    fake.repoHooks.push({
      repoFullName: 'compai/app',
      hookId: 101n,
      secret: 'sealed',
      createdBy: 'usr_1',
      status: 'active',
      idleSince: null,
      sweepLeaseUntil: null,
      createdAt: new Date(),
    })
    seedSubscription({ pollBacked: false })

    await service.handlePoll()

    expect(fake.repoHooks[0]?.idleSince).toBeNull()
  })
})
