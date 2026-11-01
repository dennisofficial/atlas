import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { prEventRows, seedPrState } from '../../../../test/github-seed'
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
import { db } from '@dltech/atlas-db'

describe('GithubDeliveryService per-head verdict ledger', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('emits a green verdict on a same-SHA zero-to-green read, the #1635 hole', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 8,
        checksFailed: 0,
      }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0, checksFailed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr-a',
      payload: { verdict: 'green', headSha: 'abc123', settled: true },
    })
  })

  it('records the ledger row against the head SHA with the verdict event claimed', async () => {
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
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const ledger = await db.orm.public.GithubPrHeadCheck.where({
      repoFullName: 'compai/app',
      prNumber: 42,
      headSha: 'abc123',
    }).all()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ verdict: 'green' })
    expect(ledger[0]?.verdictEventId).toBe('compai/app:42:abc123:verdict:green')
    expect(ledger[0]?.settledAt).not.toBeNull()
  })

  it('does not re-emit a settled verdict on a steady-state re-read', async () => {
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
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
  })

  it('a crash-replayed observation inserts exactly one event per (head, kind, user)', async () => {
    const readPullRequest = async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      checksFailed: 0,
      mergeable: true,
    })
    const { service } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' }, readPullRequest })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 0, mergeable: null })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const events = await prEventRows()
    expect(events.filter((row) => row.kind === 'verdict')).toHaveLength(1)
    expect(events.filter((row) => row.kind === 'mergeability')).toHaveLength(1)
  })

  it('announces a verdict for a brand-new PR row that already reads settled', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-a': 'ghu_a' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 4,
        checksFailed: 0,
      }),
    })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      userId: 'usr-a',
      payload: { verdict: 'green', settled: true },
    })
    // The payload write materializes a zero-check row, so the fill's null→true mergeability
    // flip announces once; a replayed delivery must not add a second row of either kind.
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    const events = await prEventRows()
    expect(events.filter((row) => row.kind === 'verdict')).toHaveLength(1)
    expect(events.filter((row) => row.kind === 'mergeability')).toHaveLength(1)
  })

  it('a settled failure emits the ledger verdict without a duplicate fail-fast verdict', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 1,
        checksFailed: 2,
      }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-fast', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 1, checksPassed: 0, checksFailed: 0 })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'failed', settled: true } })
  })

  it('keeps a merged PR check-targetable while its head owes a verdict', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        state: 'merged',
        checksRunning: 0,
        checksPassed: 5,
        checksFailed: 0,
      }),
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({
      ...FILLED_PR_STATE,
      state: 'merged',
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      updatedAt: new Date(),
    })

    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    const verdicts = (await prEventRows()).filter((row) => row.kind === 'verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ payload: { verdict: 'green' } })
  })
})
