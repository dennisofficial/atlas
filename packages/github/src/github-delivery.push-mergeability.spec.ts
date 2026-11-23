import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prEventRows, prStateRows, seedPrState, seedSubscription } from './testing/github-seed'
import { seedHeadChecks } from './github-pr-checks.fixture'
import {
  FILLED_PR_STATE,
  prepareDelivery,
  REST_FIELDS,
  seedHook,
  serviceWith,
} from './github-delivery.fixture'

const basePush = (over: Partial<{ ref: string; after: string }> = {}) => ({
  ref: 'refs/heads/main',
  after: 'def456',
  repository: { full_name: 'compai/app' },
  ...over,
})

const conflictRows = async () => (await prEventRows()).filter((row) => row.kind === 'mergeability')

describe('GithubDeliveryService base-branch push', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('records a conflict when a push to the base branch makes a tracked PR conflicting', async () => {
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      mergeable: false,
      mergeClean: false,
    }))
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedHeadChecks({ headSha: 'abc123', passed: 3 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 3, mergeable: true })

    await service.handle({ event: 'push', payload: basePush() })

    const conflicts = await conflictRows()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ payload: { mergeable: false } })
    expect((await prStateRows())[0]).toMatchObject({ mergeable: false })
  })

  it('ignores a push to a branch that is no open PR base', async () => {
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, mergeable: false }))
    const { service } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' }, readPullRequest })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, mergeable: true })

    await service.handle({ event: 'push', payload: basePush({ ref: 'refs/heads/release' }) })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await conflictRows()).toHaveLength(0)
  })

  it('retries through the outbox when GitHub has not computed mergeability yet', async () => {
    let mergeable: boolean | null = null
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      checksRunning: 0,
      checksPassed: 3,
      mergeable,
      mergeClean: mergeable === null ? null : false,
    }))
    const { service, dispatcher } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedHeadChecks({ headSha: 'abc123', passed: 3 })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 3, mergeable: true })

    await service.handle({ event: 'push', payload: basePush() })

    expect(await conflictRows()).toHaveLength(0)
    const pending = await db.orm.public.GithubPrOutbox.where({
      kind: 'mergeability-refresh',
    }).all()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ attempts: 1, dispatchedAt: null })

    mergeable = false
    await db.orm.public.GithubPrOutbox.where({ id: pending[0]?.id ?? '' }).updateAndCount({
      nextAttemptAt: new Date(Date.now() - 1_000),
    })
    await dispatcher.drain()

    const conflicts = await conflictRows()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ payload: { mergeable: false } })
  })
})
