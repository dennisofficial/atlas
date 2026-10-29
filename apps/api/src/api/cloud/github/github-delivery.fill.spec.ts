import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubCallSource } from './github-call-log'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows, seedPrState } from '../../../../test/github-seed'
import {
  CHECK_SUITE_PAYLOAD,
  FILLED_PR_STATE,
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  REST_FIELDS,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'
import { GithubUserReadFailed } from './github-user-reads'

describe('GithubDeliveryService fill', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('a pull_request delivery fills computed fields with one REST read as the hook creator', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })

    const outcome = await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).toHaveBeenCalledWith({
      source: EGithubCallSource.DeliveryFill,
      token: 'ghu_creator',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect((await prStateRows())[0]).toMatchObject({
      repoFullName: 'compai/app',
      prNumber: 42,
      checksPassed: 2,
      mergeable: true,
    })
  })

  it('records payload-derived state without computed fields when every token is gone', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    await seedHook({ createdBy: 'usr-gone' })

    const outcome = await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).not.toHaveBeenCalled()
    expect((await prStateRows())[0]).toMatchObject({
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
    await seedHook({ createdBy: 'usr-creator' })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42, mergeable: null })
  })

  it('a check_suite delivery fills every affected open PR', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { 'usr-sub': 'ghu_sub' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-gone' })
    await seedSubscription({ userId: 'usr-sub', prNumber: 42 })
    await seedPrState({
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
      source: EGithubCallSource.DeliveryFill,
      token: 'ghu_sub',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect((await prStateRows())[0]?.checksPassed).toBe(2)
  })

  it('skips check events that match no tracked PR and needs no token for them', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    await seedHook({ createdBy: 'usr-gone' })

    await service.handle({
      event: 'check_run',
      payload: {
        check_run: { head_sha: 'other', check_suite: { head_branch: 'someone/else' } },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('a check event pushes a provisional running state before the fill lands', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksPassed: 3, checksRunning: 0 })
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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, updatedAt: new Date() })
    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect(pushes).toHaveBeenCalledTimes(1)
    expect(pushes.mock.calls[0]?.[0].state).toMatchObject({
      prNumber: 42,
      checksRunning: 1,
      mergeable: null,
    })
    expect((await prStateRows())[0]).toMatchObject({
      prNumber: 42,
      checksRunning: 1,
      mergeable: null,
    })
  })

  it('ignores unknown events and handles ping without touching state', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })

    expect(await service.handle({ event: 'ping', payload: {} })).toEqual({ handled: true })
    expect(await service.handle({ event: 'issues', payload: {} })).toEqual({ handled: false })
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prStateRows()).toHaveLength(0)
  })
})
