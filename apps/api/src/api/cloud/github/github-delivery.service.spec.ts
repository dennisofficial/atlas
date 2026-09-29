import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubPrStateDto } from './github-realtime.types'
import type { GithubUserReads } from './github-user-reads'
import { GithubUserReadFailed } from './github-user-reads'
import type { GithubService } from './github.service'
import type { PullRequestCacheFields } from './github-pull-request-mapping'

const fake = fakeGithubDb()

const PULL_REQUEST_PAYLOAD = {
  action: 'opened',
  pull_request: {
    number: 42,
    title: 'add the thing',
    html_url: 'https://github.com/compai/app/pull/42',
    state: 'open',
    draft: false,
    merged_at: null,
    head: { ref: 'dennis/add-the-thing', sha: 'abc123' },
  },
  repository: { full_name: 'compai/app' },
}

const REST_FIELDS: PullRequestCacheFields = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
}

const FILLED_PR_STATE = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
  updatedAt: new Date(),
}

const CHECK_SUITE_PAYLOAD = {
  check_suite: { head_sha: 'abc123', head_branch: 'dennis/add-the-thing' },
  repository: { full_name: 'compai/app' },
}

function serviceWith(args: {
  tokens?: Record<string, string>
  readPullRequest?: GithubUserReads['readPullRequest']
}): { service: GithubDeliveryService; fanout: GithubPrFanoutService } {
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
  } as unknown as GithubUserReads
  const fanout = new GithubPrFanoutService()
  const cipher = {} as SecretCipherService
  return { service: new GithubDeliveryService(github, reads, fanout, cipher), fanout }
}

function seedHook(args: { createdBy: string }): void {
  fake.repoHooks.push({
    repoFullName: 'compai/app',
    hookId: 101n,
    secret: 'sealed',
    createdBy: args.createdBy,
    status: 'active',
    idleSince: null,
    sweepLeaseUntil: null,
    createdAt: new Date(),
  })
}

function seedSubscription(args: { userId: string; prNumber: number }): void {
  fake.subscriptions.push({
    id: `sub-${args.userId}-${args.prNumber}`,
    userId: args.userId,
    repoFullName: 'compai/app',
    prNumber: args.prNumber,
    pollBacked: false,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  })
}

describe('GithubDeliveryService', () => {
  beforeEach(() => {
    fake.reset()
    vi.useRealTimers()
  })

  it('a pull_request delivery fills computed fields with one REST read as the hook creator', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })

    const outcome = await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).toHaveBeenCalledWith({
      token: 'ghu_creator',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect(fake.prStates[0]).toMatchObject({
      repoFullName: 'compai/app',
      prNumber: 42,
      checksPassed: 2,
      mergeable: true,
    })
  })

  it('records payload-derived state without computed fields when every token is gone', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    seedHook({ createdBy: 'usr-gone' })

    const outcome = await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.prStates[0]).toMatchObject({
      prNumber: 42,
      state: 'open',
      headSha: 'abc123',
      mergeable: null,
      checksPassed: 0,
    })
  })

  it('falls back to payload state when the fill token is rejected', async () => {
    const readPullRequest = vi.fn(async () => {
      throw new GithubUserReadFailed('bad credentials', 401)
    })
    const { service } = serviceWith({ tokens: { 'usr-creator': 'ghu_dead' }, readPullRequest })
    seedHook({ createdBy: 'usr-creator' })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(fake.prStates[0]).toMatchObject({ prNumber: 42, mergeable: null })
  })

  it('a check_suite delivery fills every affected open PR', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { 'usr-sub': 'ghu_sub' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-gone' })
    seedSubscription({ userId: 'usr-sub', prNumber: 42 })
    fake.prStates.push({
      repoFullName: 'compai/app',
      prNumber: 42,
      title: 'add the thing',
      url: 'https://github.com/compai/app/pull/42',
      state: 'open',
      headBranch: 'dennis/add-the-thing',
      headSha: 'abc123',
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
      updatedAt: new Date(),
    })

    await service.handle({
      event: 'check_suite',
      payload: {
        check_suite: { head_sha: 'abc123', head_branch: 'dennis/add-the-thing' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).toHaveBeenCalledWith({
      token: 'ghu_sub',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect(fake.prStates[0]?.checksPassed).toBe(2)
  })

  it('skips check events that match no tracked PR and needs no token for them', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    seedHook({ createdBy: 'usr-gone' })

    await service.handle({
      event: 'check_run',
      payload: {
        check_run: { head_sha: 'other', check_suite: { head_branch: 'someone/else' } },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('fans the state out to live subscribers of that repo and PR', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    seedSubscription({ userId: 'usr-b', prNumber: 42 })
    seedSubscription({ userId: 'usr-c', prNumber: 7 })

    const receivedA: unknown[] = []
    const receivedC: unknown[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => receivedA.push(state) })
    fanout.openStream({ userId: 'usr-c', handler: (state) => receivedC.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(receivedA).toHaveLength(2)
    expect((receivedA[0] as { prNumber: number }).prNumber).toBe(42)
    expect(receivedC).toHaveLength(0)
  })

  it('delivers the payload-derived state to subscribers while the fill is still pending', async () => {
    let releaseFill!: (fields: PullRequestCacheFields) => void
    let fillEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      fillEntered = resolve
    })
    const readPullRequest = vi.fn(
      () =>
        new Promise<PullRequestCacheFields>((resolve) => {
          fillEntered()
          releaseFill = resolve
        }),
    )
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => received.push(state) })

    const handled = service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await entered

    await vi.waitFor(() => {
      expect(received).toHaveLength(1)
    })
    expect(received[0]).toMatchObject({ prNumber: 42, mergeable: null, checksRunning: 0, checksPassed: 0 })

    releaseFill(REST_FIELDS)
    await handled

    await vi.waitFor(() => {
      expect(received).toHaveLength(2)
    })
    expect(received[1]).toMatchObject({ prNumber: 42, mergeable: true, checksPassed: 2 })
  })

  it('a check event pushes a provisional running state before the fill lands', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE, checksPassed: 3, checksRunning: 0 })
    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect(pushes).toHaveBeenCalledTimes(2)
    expect(pushes.mock.calls[0]?.[0].state).toMatchObject({
      prNumber: 42,
      checksRunning: 1,
      checksPassed: 3,
      mergeable: null,
    })
    expect(pushes.mock.calls[1]?.[0].state).toMatchObject({
      prNumber: 42,
      checksRunning: 1,
      checksPassed: 2,
      mergeable: true,
    })
  })

  it('keeps the provisional state when the check fill dies', async () => {
    const readPullRequest = vi.fn(async () => {
      throw new GithubUserReadFailed('bad credentials', 401)
    })
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_dead' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE, updatedAt: new Date() })
    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect(pushes).toHaveBeenCalledTimes(1)
    expect(pushes.mock.calls[0]?.[0].state).toMatchObject({ prNumber: 42, checksRunning: 1, mergeable: null })
    expect(fake.prStates[0]).toMatchObject({ prNumber: 42, checksRunning: 1, mergeable: null })
  })


  it('coalesces a check storm into the first frame plus one latest-state follow-up', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => received.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(2)
  })

  it('ignores unknown events and handles ping without touching state', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })

    expect(await service.handle({ event: 'ping', payload: {} })).toEqual({ handled: true })
    expect(await service.handle({ event: 'issues', payload: {} })).toEqual({ handled: false })
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.prStates).toHaveLength(0)
  })
})
