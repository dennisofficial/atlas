import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
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
    head: { ref: 'dennis/add-the-thing', sha: 'abc123', repo: { full_name: 'compai/app' } },
  },
  repository: { full_name: 'compai/app' },
}

const REST_FIELDS: PullRequestCacheFields = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
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
  headRepoFullName: 'compai/app',
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
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const cipher = {} as SecretCipherService
  const mailbox = new GithubPrEventMailboxService(fanout)
  const discussion = new GithubPrDiscussionDeliveryService(mailbox)
  return {
    service: new GithubDeliveryService(github, reads, fanout, cipher, mailbox, discussion),
    fanout,
  }
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

function seedSubscription(args: {
  userId: string
  prNumber: number | null
  branch?: string
}): void {
  fake.subscriptions.push({
    id: `sub-${args.userId}-${args.prNumber ?? args.branch}`,
    userId: args.userId,
    repoFullName: 'compai/app',
    prNumber: args.prNumber,
    branch: args.branch ?? '',
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
      headRepoFullName: 'compai/app',
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

  it('a pull_request delivery reaches a branch subscriber whose row has no pr number', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    seedSubscription({ userId: 'usr-other', prNumber: null, branch: 'someone/else' })

    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-branch', handler: (state) => received.push(state) })
    const receivedOther: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-other', handler: (state) => receivedOther.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(received.length).toBeGreaterThan(0)
    expect(received[0]).toMatchObject({ prNumber: 42, headBranch: 'dennis/add-the-thing' })
    expect(receivedOther).toHaveLength(0)
  })

  it('a pull_request delivery reaches both the number subscriber and the branch subscriber', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-number', prNumber: 42 })
    seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })

    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await vi.advanceTimersByTimeAsync(1_100)

    const userIdSets = pushes.mock.calls.map((call) => [...call[0].userIds].sort().join(','))
    expect(userIdSets.every((ids) => ids === 'usr-branch,usr-number')).toBe(true)
    expect(userIdSets.length).toBeGreaterThan(0)
  })

  it('a fork-head pull_request never branch-routes to a same-name branch on the base repo', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({ ...REST_FIELDS, headRepoFullName: 'forker/app' }),
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    seedSubscription({ userId: 'usr-number', prNumber: 42 })

    const receivedBranch: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-branch', handler: (state) => receivedBranch.push(state) })

    const forkPayload = {
      ...PULL_REQUEST_PAYLOAD,
      pull_request: {
        ...PULL_REQUEST_PAYLOAD.pull_request,
        head: { ref: 'dennis/add-the-thing', sha: 'abc123', repo: { full_name: 'forker/app' } },
      },
    }
    await service.handle({ event: 'pull_request', payload: forkPayload })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(receivedBranch).toHaveLength(0)
    expect(fake.prStates[0]).toMatchObject({ prNumber: 42, headBranch: 'dennis/add-the-thing' })
  })

  it('a pull_request with a deleted head repo never branch-routes', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({ ...REST_FIELDS, headRepoFullName: null }),
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })

    const receivedBranch: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-branch', handler: (state) => receivedBranch.push(state) })

    const orphanPayload = {
      ...PULL_REQUEST_PAYLOAD,
      pull_request: {
        ...PULL_REQUEST_PAYLOAD.pull_request,
        head: { ref: 'dennis/add-the-thing', sha: 'abc123', repo: null },
      },
    }
    await service.handle({ event: 'pull_request', payload: orphanPayload })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(receivedBranch).toHaveLength(0)
  })

  it('a delivery for a row written before headRepoFullName existed routes on the incoming fields', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    fake.prStates.push({
      repoFullName: 'compai/app',
      prNumber: 42,
      title: 'add the thing',
      url: 'https://github.com/compai/app/pull/42',
      state: 'open',
      headBranch: 'dennis/add-the-thing',
      headSha: 'abc123',
      headRepoFullName: null,
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
      updatedAt: new Date(),
    })

    const receivedBranch: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-branch', handler: (state) => receivedBranch.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(receivedBranch.length).toBeGreaterThan(0)
  })

  it('a PR issue_comment delivery writes a mailbox row per subscriber and pushes a live frame', async () => {
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    seedSubscription({ userId: 'usr-b', prNumber: 42 })
    seedSubscription({ userId: 'usr-c', prNumber: 7 })

    const received: unknown[] = []
    fanout.openStream({
      userId: 'usr-a',
      handler: () => undefined,
      eventHandler: (event) => received.push(event),
    })

    const outcome = await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: {
          body: 'ship it',
          html_url: 'https://github.com/compai/app/pull/42#issuecomment-1',
        },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(outcome.handled).toBe(true)
    expect(fake.prEvents).toHaveLength(2)
    const userIds = fake.prEvents.map((row) => row.userId).sort()
    expect(userIds).toEqual(['usr-a', 'usr-b'])
    expect(fake.prEvents[0]).toMatchObject({
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: 'comment',
      deliveredAt: null,
      payload: {
        url: 'https://github.com/compai/app/pull/42#issuecomment-1',
        authorLogin: 'dennis',
        body: 'ship it',
      },
    })
    expect(
      (fake.prEvents[0]?.payload as Record<string, unknown>).headSha,
    ).toBeUndefined()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ kind: 'comment', prNumber: 42 })
  })

  it('ignores an issue_comment on a plain issue and non-created actions', async () => {
    const { service } = serviceWith({ tokens: {} })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 42, html_url: 'https://github.com/compai/app/issues/42' },
        comment: { body: 'not a pr', html_url: 'https://github.com/compai/app/issues/42#issuecomment-2' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })
    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'edited',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: { body: 'edited', html_url: 'https://github.com/compai/app/pull/42#issuecomment-3' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(fake.prEvents).toHaveLength(0)
  })

  it('records an approved review with its body and state', async () => {
    const { service } = serviceWith({ tokens: {} })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    const outcome = await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'approved',
          body: 'looks good',
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-1',
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(outcome.handled).toBe(true)
    expect(fake.prEvents).toHaveLength(1)
    expect(fake.prEvents[0]).toMatchObject({
      kind: 'review',
      payload: {
        url: 'https://github.com/compai/app/pull/42#pullrequestreview-1',
        authorLogin: 'reviewer',
        body: 'looks good',
        reviewState: 'approved',
        headSha: 'abc123',
      },
    })
  })

  it('skips review states that are not recorded and non-submitted actions', async () => {
    const { service } = serviceWith({ tokens: {} })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: { state: 'dismissed', body: null, html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-9' },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })
    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'edited',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: { state: 'approved', body: null, html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-1' },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(fake.prEvents).toHaveLength(0)
  })

  it('records an inline review comment', async () => {
    const { service } = serviceWith({ tokens: {} })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review_comment',
      payload: {
        action: 'created',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        comment: {
          body: 'nit: rename this',
          html_url: 'https://github.com/compai/app/pull/42#discussion_r1',
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(fake.prEvents).toHaveLength(1)
    expect(fake.prEvents[0]).toMatchObject({
      kind: 'review-comment',
      payload: {
        url: 'https://github.com/compai/app/pull/42#discussion_r1',
        authorLogin: 'reviewer',
        body: 'nit: rename this',
        headSha: 'abc123',
      },
    })
  })

  it('a comment delivery reaches a branch subscriber through the recorded head branch', async () => {
    const { service } = serviceWith({ tokens: {} })
    seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    fake.prStates.push({ ...FILLED_PR_STATE })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: { body: 'nice', html_url: 'https://github.com/compai/app/pull/42#issuecomment-4' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(fake.prEvents).toHaveLength(1)
    expect(fake.prEvents[0]?.userId).toBe('usr-branch')
  })

  it('records no mailbox row when nobody subscribes', async () => {
    const { service } = serviceWith({ tokens: {} })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: { body: 'hello', html_url: 'https://github.com/compai/app/pull/42#issuecomment-5' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(fake.prEvents).toHaveLength(0)
  })

  it('records a failed verdict when a check failure first appears', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 2,
        checksFailed: 1,
      }),
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = fake.prEvents.filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr-a',
      payload: { verdict: 'failed', headSha: 'abc123', url: 'https://github.com/compai/app/pull/42' },
    })
    expect(
      (verdicts[0]?.payload as Record<string, unknown>).authorLogin,
    ).toBeUndefined()
  })

  it('records a green verdict when checks settle passing after running', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 3,
        checksFailed: 0,
      }),
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE, checksRunning: 1, checksPassed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = fake.prEvents.filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green' } })
  })

  it('records no verdict on a steady-state re-read', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 2,
        checksFailed: 1,
      }),
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 2, checksFailed: 1 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect(fake.prEvents.filter((row) => row.kind === 'verdict')).toHaveLength(0)
  })

  it('records a mergeability flip but not a repeated mergeable value', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, checksRunning: 0, checksPassed: 3, mergeable: true }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 3, mergeable: false })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    const flips = fake.prEvents.filter((row) => row.kind === 'mergeability')
    expect(flips.length).toBeGreaterThan(0)
    expect(flips[flips.length - 1]).toMatchObject({ payload: { mergeable: true } })
    const settled = fake.prStates[0]
    expect(settled).toMatchObject({ mergeable: true })

    const before = fake.prEvents.filter((row) => row.kind === 'mergeability').length
    readPullRequest.mockImplementation(async () => ({ ...REST_FIELDS, checksRunning: 0, checksPassed: 3, mergeable: true }))
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    expect(fake.prEvents.filter((row) => row.kind === 'mergeability')).toHaveLength(before)
  })

  it('records a merged state transition when the fill first reports merged', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      state: 'merged',
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({ ...FILLED_PR_STATE })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const stateEvents = fake.prEvents.filter((row) => row.kind === 'state')
    expect(stateEvents).toHaveLength(1)
    expect(stateEvents[0]).toMatchObject({ payload: { state: 'merged' } })
  })

  it('records verdicts per subscriber verdict timing: fail-fast fires mid-run, settled waits', async () => {
    let running = true
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: running ? 9 : 0,
      checksPassed: running ? 0 : 9,
      checksFailed: 1,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-fast', prNumber: 42 })
    seedSubscription({ userId: 'usr-settled', prNumber: 42 })
    fake.cloudSettings.push({
      id: 'set-usr-settled',
      userId: 'usr-settled',
      key: 'github.prEvents.verdictTiming',
      value: 'atlas-setting:v1:"settled"',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    fake.prStates.push({ ...FILLED_PR_STATE, checksRunning: 10, checksPassed: 0, checksFailed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const midRun = fake.prEvents.filter((row) => row.kind === 'verdict')
    expect(midRun).toHaveLength(1)
    expect(midRun[0]).toMatchObject({ userId: 'usr-fast', payload: { verdict: 'failed' } })

    running = false
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const settled = fake.prEvents.filter(
      (row) => row.kind === 'verdict' && row.userId === 'usr-settled',
    )
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ payload: { verdict: 'failed' } })
    expect(
      fake.prEvents.filter((row) => row.kind === 'verdict' && row.userId === 'usr-fast'),
    ).toHaveLength(1)
  })

  it('suppresses the mid-run mergeability flip and bundles it with the settled verdict', async () => {
    let running = true
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: running ? 5 : 0,
      checksPassed: running ? 3 : 10,
      checksFailed: 0,
      mergeable: true,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    seedHook({ createdBy: 'usr-creator' })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })
    fake.prStates.push({
      ...FILLED_PR_STATE,
      checksRunning: 10,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
    })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect(fake.prEvents.filter((row) => row.kind === 'mergeability')).toHaveLength(0)

    running = false
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const kinds = fake.prEvents.map((row) => row.kind)
    expect(kinds.filter((kind) => kind === 'verdict')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'mergeability')).toHaveLength(1)
    expect(fake.prEvents.find((row) => row.kind === 'mergeability')).toMatchObject({
      payload: { mergeable: true },
    })
  })

  it('records no transition events for a brand-new PR row', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS }))
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.prStates).toHaveLength(1)
    expect(fake.prEvents).toHaveLength(0)
  })
})
