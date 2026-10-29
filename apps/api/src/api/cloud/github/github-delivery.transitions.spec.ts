import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  prEventRows,
  prStateRows,
  seedPrState,
  seedUserSetting,
} from '../../../../test/github-seed'
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

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

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
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 1, checksPassed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 2, checksFailed: 1 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect((await prEventRows()).filter((row) => row.kind === 'verdict')).toHaveLength(0)
  })

  it('records a mergeability flip but not a repeated mergeable value', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      mergeable: true,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 3, mergeable: false })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    const flips = (await prEventRows()).filter((row) => row.kind === 'mergeability')
    expect(flips.length).toBeGreaterThan(0)
    expect(flips[flips.length - 1]).toMatchObject({ payload: { mergeable: true } })
    const settled = (await prStateRows())[0]
    expect(settled).toMatchObject({ mergeable: true })

    const before = (await prEventRows()).filter((row) => row.kind === 'mergeability').length
    readPullRequest.mockImplementation(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      mergeable: true,
    }))
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    expect((await prEventRows()).filter((row) => row.kind === 'mergeability')).toHaveLength(before)
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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const stateEvents = (await prEventRows()).filter((row) => row.kind === 'state')
    expect(stateEvents).toHaveLength(1)
    expect(stateEvents[0]).toMatchObject({ payload: { state: 'merged' } })
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
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 10, checksPassed: 0, checksFailed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const midRun = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(midRun).toHaveLength(1)
    expect(midRun[0]).toMatchObject({ userId: 'usr-fast', payload: { verdict: 'failed' } })

    running = false
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const settled = (await prEventRows()).filter(
      (row) => row.kind === 'verdict' && row.userId === 'usr-settled',
    )
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ payload: { verdict: 'failed' } })
    const fast = (await prEventRows()).filter(
      (row) => row.kind === 'verdict' && row.userId === 'usr-fast',
    )
    expect(fast).toHaveLength(2)
    expect(fast[1]).toMatchObject({ payload: { verdict: 'failed', settled: true } })
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
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      checksRunning: 10,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
    })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect((await prEventRows()).filter((row) => row.kind === 'mergeability')).toHaveLength(0)

    running = false
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const kinds = (await prEventRows()).map((row) => row.kind)
    expect(kinds.filter((kind) => kind === 'verdict')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'mergeability')).toHaveLength(1)
    expect((await prEventRows()).find((row) => row.kind === 'mergeability')).toMatchObject({
      payload: { mergeable: true },
    })
  })

  it('records no transition events for a brand-new PR row', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS }))
    const { service } = serviceWith({ tokens: {}, readPullRequest })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prStateRows()).toHaveLength(1)
    expect(await prEventRows()).toHaveLength(0)
  })
})
