import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureUsers,
  prEventRows,
  prStateRows,
  repoHookRows,
  seedCloudSandbox,
  seedPrState as seedPrStateRow,
  seedRepoHook,
  seedSubscription as seedSubscriptionRow,
  subscriptionRows,
} from '../../../../test/github-seed'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { GithubUserReads } from './github-user-reads'
import { GithubUserReadFailed } from './github-user-reads'
import type { GithubService } from './github.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'

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
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  const mailbox = new GithubPrEventMailboxService(fanout, wake)
  return { service: new GithubPollSweeperService(github, reads, fanout, mailbox), fanout }
}

const seedSubscription = (overrides: Partial<Row<'GithubSubscription'>> = {}) =>
  seedSubscriptionRow({
    id: 'sub-1',
    userId: 'usr_1',
    branch: '#42',
    pollBacked: true,
    ...overrides,
  })

const seedPrState = (overrides: Partial<Row<'GithubPrState'>> = {}) =>
  seedPrStateRow({ checksPassed: 3, checksFailed: 1, mergeable: false, ...overrides })

describe('GithubPollSweeperService', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.useRealTimers()
    await ensureUsers('usr_1', 'usr_2')
  })

  it('polls a live poll-backed subscription as its user and pushes the diff', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()

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
    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42, checksFailed: 1, mergeable: false })
    expect(received).toHaveLength(1)
  })

  it('skips expired subscriptions', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription({
      id: 'sub-2',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() - 60_000),
    })

    await service.handlePoll()

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('records a merged state event when a poll-backed read first reports merged', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, state: 'merged' }))
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({ state: 'open' })

    await service.handlePoll()

    const states = (await prEventRows()).filter((row) => row.kind === 'state')
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({
      userId: 'usr_1',
      prNumber: 42,
      payload: { state: 'merged', url: 'https://github.com/compai/app/pull/42' },
    })
  })

  it('records a green verdict when a poll-backed read settles passing after running', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: true,
    }))
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState({ checksRunning: 2, checksPassed: 1, checksFailed: 0 })

    await service.handlePoll()

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green' } })
  })

  it('records no event on a steady-state re-read of a poll-backed pr', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()
    await seedPrState()

    await service.handlePoll()

    expect(await prEventRows()).toHaveLength(0)
  })

  it('records no event when a poll-backed pr row is brand new', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, state: 'merged' }))
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription()

    await service.handlePoll()

    expect(await prEventRows()).toHaveLength(0)
  })

  it('re-anchors a hook-backed subscription whose state row is missing', async () => {
    vi.useFakeTimers()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })

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
    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42 })
    expect(received).toHaveLength(1)
  })

  it('re-anchors a hook-backed subscription whose state row has gone quiet', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: new Date(Date.now() - 11 * 60 * 1_000) })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalled()
  })

  it('leaves a hook-backed subscription alone while webhooks keep its state row fresh', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedSubscription({ pollBacked: false })
    await seedPrState({ updatedAt: new Date(Date.now() - 2 * 60 * 1_000) })

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
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing', pollBacked: false })

    await service.handlePoll()

    expect(findOpenPrForBranch).not.toHaveBeenCalled()
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
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_dead' }, readPullRequest })
    await seedSubscription()

    await expect(service.handlePoll()).resolves.toBeUndefined()
    expect(await prStateRows()).toHaveLength(0)
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
    await seedSubscription({ prNumber: null, branch: 'dennis/add-the-thing' })

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
    expect((await subscriptionRows())[0]?.prNumber).toBe(42)
    expect(readPullRequest).toHaveBeenCalledWith({
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
      tokens: { 'usr_1': 'ghu_1' },
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
    const { service, fanout } = serviceWith({ tokens: { 'usr_1': 'ghu_1' } })
    await seedSubscription()
    await seedSubscriptionRow({
      id: 'sub-branch',
      userId: 'usr_2',
      prNumber: null,
      branch: 'dennis/add-the-thing',
    })

    const pushes = vi.spyOn(fanout, 'push')

    await service.handlePoll()
    await vi.advanceTimersByTimeAsync(1_100)

    expect(pushes).toHaveBeenCalled()
    expect([...pushes.mock.calls[0]![0].userIds].sort()).toEqual(['usr_1', 'usr_2'])
  })

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

  beforeEach(async () => {
    vi.useRealTimers()
    await ensureUsers('usr_1', 'usr_2')
  })

  it('polls an expired subscription whose sandbox is inside the wake window', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr_1': 'ghu_1' }, readPullRequest })
    await seedCloudSandbox({
      id: 'sbx_row_1',
      threadId: 'thr_1',
      userId: 'usr_1',
      name: 'atlas-thr_1',
      state: 'parked',
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1_000),
    })
    await seedSubscription({
      id: 'sub-parked',
      prNumber: 7,
      expiresAt: new Date(Date.now() - 60_000),
      threadId: 'thr_1',
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
    await seedCloudSandbox({
      id: 'sbx_row_1',
      threadId: 'thr_1',
      userId: 'usr_1',
      name: 'atlas-thr_1',
      state: 'parked',
      lastActivityAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
    })
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
