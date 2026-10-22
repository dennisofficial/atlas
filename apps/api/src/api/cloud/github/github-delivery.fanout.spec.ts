import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows, seedPrState } from '../../../../test/github-seed'
import { advanceTimersByTimeAsync, waitFor } from '../../../../test/fake-timers'
import {
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  REST_FIELDS,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import type { GithubPrStateDto } from './github-realtime.types'

describe('GithubDeliveryService fanout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  useTestDatabase()

  beforeEach(prepareDelivery)

  it('fans the state out to live subscribers of that repo and PR', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedSubscription({ userId: 'usr-b', prNumber: 42 })
    await seedSubscription({ userId: 'usr-c', prNumber: 7 })

    const receivedA: unknown[] = []
    const receivedC: unknown[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => receivedA.push(state) })
    fanout.openStream({ userId: 'usr-c', handler: (state) => receivedC.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await advanceTimersByTimeAsync(1_100)

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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => received.push(state) })

    const handled = service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await entered

    await waitFor(() => {
      expect(received).toHaveLength(1)
    })
    expect(received[0]).toMatchObject({
      prNumber: 42,
      mergeable: null,
      checksRunning: 0,
      checksPassed: 0,
    })

    releaseFill(REST_FIELDS)
    await handled

    await waitFor(() => {
      expect(received).toHaveLength(2)
    })
    expect(received[1]).toMatchObject({ prNumber: 42, mergeable: true, checksPassed: 2 })
  })

  it('coalesces a check storm into the first frame plus one latest-state follow-up', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    const received: unknown[] = []
    fanout.openStream({ userId: 'usr-a', handler: (state) => received.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await advanceTimersByTimeAsync(1_100)

    expect(received).toHaveLength(2)
  })

  it('a pull_request delivery reaches a branch subscriber whose row has no pr number', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    await seedSubscription({ userId: 'usr-other', prNumber: null, branch: 'someone/else' })

    const received: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-branch', handler: (state) => received.push(state) })
    const receivedOther: GithubPrStateDto[] = []
    fanout.openStream({ userId: 'usr-other', handler: (state) => receivedOther.push(state) })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await advanceTimersByTimeAsync(1_100)

    expect(received.length).toBeGreaterThan(0)
    expect(received[0]).toMatchObject({ prNumber: 42, headBranch: 'dennis/add-the-thing' })
    expect(receivedOther).toHaveLength(0)
  })

  it('a pull_request delivery reaches both the number subscriber and the branch subscriber', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-number', prNumber: 42 })
    await seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })

    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    await advanceTimersByTimeAsync(1_100)

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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    await seedSubscription({ userId: 'usr-number', prNumber: 42 })

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
    await advanceTimersByTimeAsync(1_100)

    expect(receivedBranch).toHaveLength(0)
    expect((await prStateRows())[0]).toMatchObject({
      prNumber: 42,
      headBranch: 'dennis/add-the-thing',
    })
  })

  it('a pull_request with a deleted head repo never branch-routes', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({ ...REST_FIELDS, headRepoFullName: null }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })

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
    await advanceTimersByTimeAsync(1_100)

    expect(receivedBranch).toHaveLength(0)
  })

  it('a delivery for a row written before headRepoFullName existed routes on the incoming fields', async () => {
    vi.useFakeTimers()
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    await seedPrState({
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
    await advanceTimersByTimeAsync(1_100)

    expect(receivedBranch.length).toBeGreaterThan(0)
  })
})
