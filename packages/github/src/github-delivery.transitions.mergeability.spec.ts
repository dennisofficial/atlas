import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows, prStateRows, seedPrState, seedSubscription } from './testing/github-seed'
import { seedHeadChecks } from './github-pr-checks.fixture'
import {
  FILLED_PR_STATE,
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  REST_FIELDS,
  seedHook,
  serviceWith,
} from './github-delivery.fixture'

describe('GithubDeliveryService mergeability transitions', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

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
    await seedHeadChecks({ headSha: 'abc123', passed: 3 })
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
