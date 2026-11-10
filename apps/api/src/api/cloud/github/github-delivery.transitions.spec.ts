import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  prEventRows,
  prStateRows,
  seedPrState,
  seedUserSetting,
} from '../../../../test/github-seed'
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

describe('GithubDeliveryService transition events', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE })

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr-a',
      payload: {
        verdict: 'failed',
        headSha: 'abc123',
        url: 'https://github.com/compai/app/pull/42',
      },
    })
    expect(
      (verdicts[0]?.payload as Record<string, unknown> | undefined)?.authorLogin,
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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 1,
      checksPassed: 0,
    })

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green' } })
  })

  it('announces the owed verdict on the first settled read', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 2,
        checksFailed: 1,
      }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 0,
      checksPassed: 2,
      checksFailed: 1,
    })

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    expect((await prEventRows()).filter((row) => row.kind === 'verdict')).toHaveLength(1)
  })

  it('records a conflict straight away and not a repeated one', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 3,
      checksPassed: 1,
      mergeable: false,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 3,
      checksPassed: 1,
      mergeable: true,
    })

    await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })
    const flips = (await prEventRows()).filter((row) => row.kind === 'mergeability')
    expect(flips).toHaveLength(1)
    expect(flips[0]).toMatchObject({ payload: { mergeable: false } })
    expect((await prStateRows())[0]).toMatchObject({ mergeable: false })

    await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })
    expect((await prEventRows()).filter((row) => row.kind === 'mergeability')).toHaveLength(1)
  })

  it('says nothing when a pull request whose CI already finished turns mergeable', async () => {
    let mergeable: boolean | null = null
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
      mergeable,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: null,
    })

    await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })
    const announced = await prEventRows()
    expect(announced.filter((row) => row.kind === 'verdict')).toHaveLength(1)

    mergeable = true
    await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })

    expect(await prEventRows()).toHaveLength(announced.length)
    expect((await prStateRows())[0]).toMatchObject({ mergeable: true })
  })

  it('records verdicts per subscriber verdict timing: fail-fast fires mid-run and again when the run finishes, settled waits', async () => {
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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-fast', prNumber: 42 })
    await seedSubscription({ userId: 'usr-settled', prNumber: 42 })
    await seedUserSetting({
      userId: 'usr-settled',
      key: 'github.prEvents.verdictTiming',
      value: 'atlas-setting:v1:"settled"',
    })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 10,
      checksPassed: 0,
      checksFailed: 0,
    })

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    const midRun = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(midRun).toHaveLength(1)
    expect(midRun[0]).toMatchObject({
      userId: 'usr-fast',
      payload: { verdict: 'failed' },
    })

    running = false
    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    const settled = (await prEventRows()).filter(
      (row) => row.kind === 'verdict' && row.userId === 'usr-settled',
    )
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ payload: { verdict: 'failed' } })
    const fast = (await prEventRows()).filter(
      (row) => row.kind === 'verdict' && row.userId === 'usr-fast',
    )
    expect(fast).toHaveLength(2)
    expect(fast[1]).toMatchObject({
      payload: { verdict: 'failed', settled: true },
    })
  })

  it('carries the mergeability on the verdict that closes CI instead of a notice of its own', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 10,
      checksFailed: 0,
      mergeable: true,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 10,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
    })

    await service.handle({
      event: 'check_run',
      payload: checkRunPayload({
        status: 'in_progress',
        conclusion: null,
        completed_at: null,
      }),
    })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect((await prEventRows()).filter((row) => row.kind === 'mergeability')).toHaveLength(0)

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green', mergeable: true } })
    expect((await prEventRows()).filter((row) => row.kind === 'mergeability')).toHaveLength(0)
  })

  it('records no transition events for a brand-new PR row', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS }))
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request',
      payload: PULL_REQUEST_PAYLOAD,
    })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prStateRows()).toHaveLength(1)
    expect(await prEventRows()).toHaveLength(0)
  })
})
