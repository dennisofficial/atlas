import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb, seedCloudSandbox } from '../../../../test/fake-github-db'
import { DrainStateService } from '../../platform/health/drain-state.service'
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
  headRepoFullName: 'compai/app',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 1,
  mergeable: false,
}

function serviceWith(args: {
  tokens?: Record<string, string>
  readPullRequest?: GithubUserReads['readPullRequest']
  findOpenPrForBranch?: GithubUserReads['findOpenPrForBranch']
}): { service: GithubPollSweeperService; fanout: GithubPrFanoutService } {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
    findOpenPrForBranch: args.findOpenPrForBranch ?? (async () => null),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService(new DrainStateService())
  return { service: new GithubPollSweeperService(github, reads, fanout), fanout }
}

function seedSubscription(overrides: Partial<(typeof fake.subscriptions)[number]> = {}): void {
  fake.subscriptions.push({
    id: 'sub-1',
    userId: 'usr_1',
    repoFullName: 'compai/app',
    prNumber: 42,
    branch: '',
    pollBacked: true,
    expiresAt: new Date(Date.now() + 60_000),
    threadId: null,
    sandboxId: null,
    createdAt: new Date(),
    ...overrides,
  })
}

function seedPrState(overrides: Partial<(typeof fake.prStates)[number]> = {}): void {
  fake.prStates.push({
    repoFullName: 'compai/app',
    prNumber: 42,
    title: 'add the thing',
    url: 'https://github.com/compai/app/pull/42',
    state: 'open',
    headBranch: 'dennis/add-the-thing',
    headSha: 'abc123',
    headRepoFullName: 'compai/app',
    checksRunning: 0,
    checksPassed: 3,
    checksFailed: 1,
    mergeable: false,
    updatedAt: new Date(),
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

  it('skips expired subscriptions', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedSubscription({ id: 'sub-2', prNumber: 7, expiresAt: new Date(Date.now() - 60_000) })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('re-anchors a hook-backed subscription whose state row is missing', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedSubscription({ pollBacked: false })

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
    expect(fake.prStates[0]).toMatchObject({ prNumber: 42 })
    expect(received).toHaveLength(1)
  })

  it('re-anchors a hook-backed subscription whose state row has gone quiet', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedSubscription({ pollBacked: false })
    seedPrState({ updatedAt: new Date(Date.now() - 11 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalled()
  })

  it('leaves a hook-backed subscription alone while webhooks keep its state row fresh', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedSubscription({ pollBacked: false })
    seedPrState({ updatedAt: new Date(Date.now() - 2 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('skips a hook-backed branch row with no pr number — webhooks route it by branch', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const findOpenPrForBranch = vi.fn(async () => ({ number: 42 }))
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      readPullRequest,
      findOpenPrForBranch,
    })
    seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing', pollBacked: false })

    await service.handlePoll()

    expect(findOpenPrForBranch).not.toHaveBeenCalled()
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

  it('re-resolves a poll-backed branch row with no pr number and records the found pr', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const findOpenPrForBranch = vi.fn(async () => ({ number: 42 }))
    const { service, fanout } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      readPullRequest,
      findOpenPrForBranch,
    })
    seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr_1', handler: (state) => received.push(state) })

    await service.handlePoll()
    await vi.advanceTimersByTimeAsync(1_100)

    expect(findOpenPrForBranch).toHaveBeenCalledWith({
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      branch: 'dennis/add-the-thing',
    })
    expect(fake.subscriptions[0]?.prNumber).toBe(42)
    expect(readPullRequest).toHaveBeenCalledWith({
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect(fake.prStates[0]).toMatchObject({ prNumber: 42 })
    expect(received).toHaveLength(1)
  })

  it('leaves a poll-backed branch row unresolved while no open pr exists for it', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const findOpenPrForBranch = vi.fn(async () => null)
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      readPullRequest,
      findOpenPrForBranch,
    })
    seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

    await service.handlePoll()

    expect(findOpenPrForBranch).toHaveBeenCalled()
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.subscriptions[0]?.prNumber).toBeNull()
    expect(fake.prStates).toHaveLength(0)
  })

  it('a poll for a known pr reaches a branch subscriber of the same repo', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr_1': 'ghu_1' } })
    seedSubscription()
    fake.subscriptions.push({
      id: 'sub-branch',
      userId: 'usr_2',
      repoFullName: 'compai/app',
      prNumber: null,
      branch: 'dennis/add-the-thing',
      pollBacked: false,
      expiresAt: new Date(Date.now() + 60_000),
      threadId: null,
      sandboxId: null,
      createdAt: new Date(),
    })

    const pushes = vi.spyOn(fanout, 'push')

    await service.handlePoll()
    await vi.advanceTimersByTimeAsync(1_100)

    expect(pushes).toHaveBeenCalled()
    expect([...pushes.mock.calls[0]![0].userIds].sort()).toEqual(['usr_1', 'usr_2'])
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

describe('GithubPollSweeperService parked-subscription survival', () => {
  beforeEach(() => {
    fake.reset()
    vi.useRealTimers()
  })

  it('polls an expired subscription whose sandbox is inside the wake window', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedCloudSandbox({
      id: 'sbx_row_1',
      threadId: 'thr_1',
      userId: 'usr_1',
      sandboxId: 'sbx_1',
      name: 'atlas-thr_1',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
    })
    seedSubscription({
      id: 'sub-parked',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledWith({
      token: 'ghu_1',
      owner: 'compai',
      repo: 'app',
      number: 7,
    })
  })

  it('skips an expired subscription whose sandbox fell out of the wake window', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    seedCloudSandbox({
      id: 'sbx_row_1',
      threadId: 'thr_1',
      userId: 'usr_1',
      sandboxId: 'sbx_1',
      name: 'atlas-thr_1',
      region: 'iad1',
      state: 'parked',
      lastActivityAt: new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString(),
    })
    seedSubscription({
      id: 'sub-stale',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })
})
