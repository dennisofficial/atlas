import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb, seedCloudSandbox, type FakeSubscriptionRow } from '../../../../test/fake-github-db'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { GithubUserReads } from './github-user-reads'
import { GithubSubscriptionsService } from './github-subscriptions.service'
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
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
}

const okFetch = async () => new Response('{}', { status: 200 })

function serviceWith(args: {
  token?: string
  ensureHook?: 'created' | 'existing' | 'poll-backed'
  readPullRequest?: GithubUserReads['readPullRequest']
  findOpenPrForBranch?: GithubUserReads['findOpenPrForBranch']
  fetchImpl?: typeof fetch
}): GithubSubscriptionsService {
  const github = {
    findToken: async () => args.token,
  } as unknown as GithubService
  const hooks = {
    ensureHook: vi.fn(async () => args.ensureHook ?? 'created'),
  } as unknown as GithubHookLifecycleService
  const reads = {
    readPullRequest: args.readPullRequest ?? (async () => REST_FIELDS),
    findOpenPrForBranch: args.findOpenPrForBranch ?? (async () => ({ number: 42 })),
  } as unknown as GithubUserReads
  vi.stubGlobal('fetch', args.fetchImpl ?? okFetch)
  return new GithubSubscriptionsService(github, reads, hooks)
}

describe('GithubSubscriptionsService', () => {
  beforeEach(() => fake.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('validates access, ensures the hook, upserts the subscription and pulls the current state', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect(dto.pollBacked).toBe(false)
    expect(fake.subscriptions).toHaveLength(1)
    expect(fake.prStates).toHaveLength(1)
    expect(dto.state).toMatchObject({ prNumber: 42, checksPassed: 2, mergeable: true })
    expect(Date.parse(dto.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('resolves a branch to its open pull request and keys the row by branch', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(fake.subscriptions).toHaveLength(1)
    expect(fake.subscriptions[0]).toMatchObject({
      prNumber: 42,
      branch: 'dennis/add-the-thing',
    })
    expect(dto.prNumber).toBe(42)
    expect(dto.branch).toBe('dennis/add-the-thing')
    expect(dto.state?.prNumber).toBe(42)
    expect(dto.state?.headBranch).toBe('dennis/add-the-thing')
  })

  it('subscribes a branch with no open pull request yet, returning a null state', async () => {
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: async () => null })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(dto.prNumber).toBeNull()
    expect(dto.branch).toBe('dennis/add-the-thing')
    expect(dto.state).toBeNull()
    expect(fake.subscriptions).toHaveLength(1)
    expect(fake.subscriptions[0]).toMatchObject({ prNumber: null, branch: 'dennis/add-the-thing' })
    expect(fake.prStates).toHaveLength(0)
  })

  it('a poll-backed branch row with no pull request yet is still recorded', async () => {
    const service = serviceWith({
      token: 'ghu_1',
      ensureHook: 'poll-backed',
      findOpenPrForBranch: async () => null,
    })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(dto.pollBacked).toBe(true)
    expect(fake.subscriptions[0]).toMatchObject({
      prNumber: null,
      branch: 'dennis/add-the-thing',
      pollBacked: true,
    })
  })

  it('a number subscribe for a pr the api will not find is still a 404 path', async () => {
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: async () => null })

    await expect(
      service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', branch: 'no/such' }),
    ).resolves.toMatchObject({ prNumber: null, branch: 'no/such' })
    expect(fake.subscriptions).toHaveLength(1)
  })

  it('re-subscribing a branch with an open PR after subscribing before it updates the row', async () => {
    const finds = vi
      .fn<() => Promise<{ number: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ number: 42 })
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: finds })

    const first = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })
    const second = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(fake.subscriptions).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(second.prNumber).toBe(42)
    expect(second.state?.prNumber).toBe(42)
  })

  it('heartbeat works on a branch row with no pull request yet', async () => {
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: async () => null })
    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })
    fake.subscriptions[0]!.expiresAt = new Date(Date.now() - 60_000)

    const beat = await service.heartbeat({ userId: 'usr_1', subscriptionId: dto.id })

    expect(Date.parse(beat.expiresAt)).toBeGreaterThan(Date.now() + 4 * 60_000)
  })

  it('marks the subscription poll-backed when the hook cannot be created', async () => {
    const service = serviceWith({ token: 'ghu_1', ensureHook: 'poll-backed' })

    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect(dto.pollBacked).toBe(true)
    expect(dto.state?.prNumber).toBe(42)
  })

  it('re-subscribing refreshes the expiry instead of duplicating the row', async () => {
    const service = serviceWith({ token: 'ghu_1', ensureHook: 'existing' })

    const first = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
    const second = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect(fake.subscriptions).toHaveLength(1)
    expect(second.id).toBe(first.id)
  })

  it('stores a number subscribe under the #<prNumber> sentinel branch so number rows never collide', async () => {
    const service = serviceWith({ token: 'ghu_1', ensureHook: 'existing' })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 87 })

    const branches = fake.subscriptions.map((row) => row.branch).sort()
    expect(branches).toEqual(['#42', '#87'])
  })

  it('refuses a repo the user cannot read on github', async () => {
    const denied = async () => new Response('{}', { status: 404 })
    const service = serviceWith({ token: 'ghu_1', fetchImpl: denied as typeof fetch })

    await expect(
      service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(fake.subscriptions).toHaveLength(0)
  })

  it('refuses callers who never connected github', async () => {
    const service = serviceWith({})

    await expect(
      service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('heartbeat pushes the expiry out five minutes', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
    fake.subscriptions[0]!.expiresAt = new Date(Date.now() - 60_000)

    const beat = await service.heartbeat({ userId: 'usr_1', subscriptionId: dto.id })

    expect(Date.parse(beat.expiresAt)).toBeGreaterThan(Date.now() + 4 * 60_000)
  })

  it('heartbeat on a subscription owned by someone else 404s', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    await expect(
      service.heartbeat({ userId: 'usr_2', subscriptionId: dto.id }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('unsubscribe removes the row and marks the repo idle when nothing live remains', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
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

    await service.unsubscribe({ userId: 'usr_1', subscriptionId: dto.id })

    expect(fake.subscriptions).toHaveLength(0)
    expect(fake.repoHooks[0]?.idleSince).not.toBeNull()
  })

  it('unsubscribe keeps the repo active while another subscription is live', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
    fake.subscriptions.push({
      id: 'sub-other',
      userId: 'usr_2',
      repoFullName: 'compai/app',
      prNumber: 7,
      branch: '',
      pollBacked: false,
      expiresAt: new Date(Date.now() + 60_000),
      threadId: null,
      sandboxId: null,
      createdAt: new Date(),
    })
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

    await service.unsubscribe({ userId: 'usr_1', subscriptionId: dto.id })

    expect(fake.repoHooks[0]?.idleSince).toBeNull()
  })

  it('unsubscribe of a missing row 404s', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    await expect(
      service.unsubscribe({ userId: 'usr_1', subscriptionId: 'sub-nope' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('currentStates returns the cached state for every live subscription with a pr number', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    fake.subscriptions.push(
      {
        id: 'sub-1',
        userId: 'usr_1',
        repoFullName: 'compai/app',
        prNumber: 42,
        branch: '',
        pollBacked: false,
        expiresAt: new Date(Date.now() + 60_000),
        threadId: null,
        sandboxId: null,
        createdAt: new Date(),
      },
      {
        id: 'sub-2',
        userId: 'usr_1',
        repoFullName: 'compai/app',
        prNumber: null,
        branch: 'dennis/fresh-branch',
        pollBacked: false,
        expiresAt: new Date(Date.now() + 60_000),
        threadId: null,
        sandboxId: null,
        createdAt: new Date(),
      },
      {
        id: 'sub-3',
        userId: 'usr_1',
        repoFullName: 'compai/app',
        prNumber: 7,
        branch: '',
        pollBacked: false,
        expiresAt: new Date(Date.now() - 60_000),
        threadId: null,
        sandboxId: null,
        createdAt: new Date(),
      },
      {
        id: 'sub-4',
        userId: 'usr_2',
        repoFullName: 'compai/app',
        prNumber: 99,
        branch: '',
        pollBacked: false,
        expiresAt: new Date(Date.now() + 60_000),
        threadId: null,
        sandboxId: null,
        createdAt: new Date(),
      },
    )
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
      checksFailed: 0,
      mergeable: true,
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
    })

    const states = await service.currentStates({ userId: 'usr_1' })

    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({
      repoFullName: 'compai/app',
      prNumber: 42,
      checksPassed: 3,
      updatedAt: '2026-09-28T00:00:00.000Z',
    })
  })
})

describe('sandbox link and park survival', () => {
  beforeEach(() => fake.reset())

  const expiredRow = (overrides: Partial<FakeSubscriptionRow> = {}): FakeSubscriptionRow => ({
    id: 'sub-parked',
    userId: 'usr_1',
    repoFullName: 'compai/app',
    prNumber: 42,
    branch: '',
    pollBacked: false,
    expiresAt: new Date(Date.now() - 60_000),
    threadId: null,
    sandboxId: null,
    createdAt: new Date(),
    ...overrides,
  })

  const sandboxRow = (overrides: Partial<Parameters<typeof seedCloudSandbox>[0]> = {}) => ({
    id: 'sbx_row_1',
    threadId: 'thr_1',
    userId: 'usr_1',
    sandboxId: 'sbx_1',
    name: 'atlas-thr_1',
    region: 'iad1',
    state: 'parked',
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  })

  it('subscribe with a sandbox principal records the thread and sandbox link', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })

    expect(fake.subscriptions[0]).toMatchObject({ threadId: 'thr_1', sandboxId: 'sbx_1' })
  })

  it('subscribe without a sandbox principal leaves the link null', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect(fake.subscriptions[0]).toMatchObject({ threadId: null, sandboxId: null })
  })

  it('re-subscribing from a different sandbox re-points the link', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })

    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_2',
      sandboxId: 'sbx_2',
    })

    expect(fake.subscriptions).toHaveLength(1)
    expect(fake.subscriptions[0]).toMatchObject({ threadId: 'thr_2', sandboxId: 'sbx_2' })
  })

  it('heartbeat from a sandbox re-points the link', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    await service.heartbeat({
      userId: 'usr_1',
      subscriptionId: dto.id,
      threadId: 'thr_1',
      sandboxId: 'sbx_1',
    })

    expect(fake.subscriptions[0]).toMatchObject({ threadId: 'thr_1', sandboxId: 'sbx_1' })
  })

  it('an expired subscription linked to a sandbox inside the wake window still counts as live', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    seedCloudSandbox(sandboxRow())
    fake.subscriptions.push(expiredRow({ threadId: 'thr_1', sandboxId: 'sbx_1' }))
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
      checksFailed: 0,
      mergeable: true,
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
    })

    const live = await service.liveSubscriptions({ userId: 'usr_1' })
    const states = await service.currentStates({ userId: 'usr_1' })

    expect(live).toHaveLength(1)
    expect(states).toHaveLength(1)
    expect(states[0]?.prNumber).toBe(42)
  })

  it('an expired subscription whose sandbox fell out of the wake window is dead', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    seedCloudSandbox(
      sandboxRow({
        lastActivityAt: new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString(),
      }),
    )
    fake.subscriptions.push(expiredRow({ threadId: 'thr_1', sandboxId: 'sbx_1' }))

    expect(await service.liveSubscriptions({ userId: 'usr_1' })).toHaveLength(0)
    expect(await service.currentStates({ userId: 'usr_1' })).toHaveLength(0)
  })

  it('an expired subscription with a threadId but no sandbox row is dead', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    fake.subscriptions.push(expiredRow({ threadId: 'thr_gone', sandboxId: 'sbx_gone' }))

    expect(await service.liveSubscriptions({ userId: 'usr_1' })).toHaveLength(0)
  })

  it('a parked-linked subscription keeps its repo hook out of the idle drain', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    seedCloudSandbox(sandboxRow())
    fake.subscriptions.push(expiredRow({ threadId: 'thr_1', sandboxId: 'sbx_1' }))
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

    await service.markIdleWhenDrained({ repoFullName: 'compai/app' })

    expect(fake.repoHooks[0]?.idleSince).toBeNull()
  })
})
