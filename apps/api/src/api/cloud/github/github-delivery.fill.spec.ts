import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubCallSource } from './github-call-log'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows, seedPrState } from '../../../../test/github-seed'
import {
  checkRunPayload,
  SETTLING_CHECK_RUN_PAYLOAD,
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

    const outcome = await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })

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

    const outcome = await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })

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
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_dead' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })

    await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })

    expect((await prStateRows())[0]).toMatchObject({
      prNumber: 42,
      mergeable: null,
    })
  })

  it('a settling check_run confirms every affected open PR with one REST read', async () => {
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

    await service.handle({ event: 'check_run', payload: checkRunPayload() })

    expect(readPullRequest).toHaveBeenCalledWith({
      source: EGithubCallSource.DeliveryFill,
      token: 'ghu_sub',
      owner: 'compai',
      repo: 'app',
      number: 42,
      collectChecks: expect.any(Function),
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
        ...checkRunPayload({ head_sha: 'other' }),
      },
    })

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('a running check_run updates counts from stored rows with no REST read', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksPassed: 3,
      checksRunning: 0,
    })
    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({
        status: 'in_progress',
        conclusion: null,
        completed_at: null,
      }),
    })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(pushes).toHaveBeenCalledTimes(1)
    expect(pushes.mock.calls[0]?.[0].state).toMatchObject({
      prNumber: 42,
      checksRunning: 1,
      checksPassed: 0,
      mergeable: true,
    })
  })

  it('falls back to the row tally when the settle confirmation token is rejected', async () => {
    const readPullRequest = vi.fn(async () => {
      throw new GithubUserReadFailed('bad credentials', 401)
    })
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_dead' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, updatedAt: new Date() })

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    expect((await prStateRows())[0]).toMatchObject({
      prNumber: 42,
      checksRunning: 0,
      checksPassed: 1,
    })
  })

  it('ignores unknown events and handles ping without touching state', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: {}, readPullRequest })

    expect(await service.handle({ event: 'ping', payload: {} })).toEqual({
      handled: true,
    })
    expect(await service.handle({ event: 'issues', payload: {} })).toEqual({
      handled: false,
    })
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prStateRows()).toHaveLength(0)
  })
})
