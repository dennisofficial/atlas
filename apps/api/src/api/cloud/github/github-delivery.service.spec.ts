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
  mergeableState: 'clean',
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

    expect(receivedA).toHaveLength(1)
    expect((receivedA[0] as { prNumber: number }).prNumber).toBe(42)
    expect(receivedC).toHaveLength(0)
  })

  it('coalesces a check storm into one push per PR', async () => {
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

    expect(received).toHaveLength(1)
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
