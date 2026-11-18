import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ETargetOutcome } from '@dltech/atlas-core'
import { ensureUsers, seedSubscription as seedSubscriptionRow } from '../../../../test/github-seed'
import type { QueueDeps } from './github-refresh-queue'
import { POLLED_REPO, queueDeps, seedTarget, sweep } from './github-refresh-queue.fixture'

describe('refreshGithubQueue claims by due time', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('attempts every due polled head once, soonest due first', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => ({ outcome: ETargetOutcome.LookedUp }))
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    const first = await seedTarget(0)
    const second = await seedTarget(1)
    for (let index = 0; index < 40; index += 1) await seedTarget(index + 2)

    await sweep(queueDeps({ lookUp, refresh }))

    const attempted = lookUp.mock.calls.map((call) => call[0].id)
    expect(attempted).toHaveLength(42)
    expect(new Set(attempted).size).toBe(42)
    expect(attempted.slice(0, 2)).toEqual([first.id, second.id])
  })

  it('parks one budget-refused target and still serves the others', async () => {
    const retryAtMs = Date.now() + 300_000
    const parked = await seedTarget(0)
    const lookUp = vi.fn<QueueDeps['lookUp']>(async (target) =>
      target.id === parked.id
        ? { outcome: ETargetOutcome.BudgetRefused, retryAtMs }
        : { outcome: ETargetOutcome.LookedUp },
    )
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    const others = [await seedTarget(1), await seedTarget(2)]

    await sweep(queueDeps({ lookUp, refresh }))

    expect(lookUp.mock.calls.map((call) => call[0].id)).toEqual([
      parked.id,
      ...others.map((row) => row.id),
    ])
    const row = await db.orm.public.GithubTrackingTarget.where({ id: parked.id }).first()
    expect(row?.nextDueAt.getTime()).toBe(retryAtMs)
    expect(row?.failures).toBe(0)
    expect(row?.leaseUntil).toBeNull()
  })

  it('turns an unresolved branch subscription into a durable head target', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => ({ outcome: ETargetOutcome.LookedUp }))
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    const subscription = await seedSubscriptionRow({
      userId: 'usr_1',
      repoFullName: POLLED_REPO,
      branch: 'dennis/unresolved',
      prNumber: null,
      pollBacked: true,
    })

    await sweep(queueDeps({ lookUp, refresh }))

    const target = await db.orm.public.GithubTrackingTarget.where({
      repoFullName: POLLED_REPO,
      branch: 'dennis/unresolved',
      kind: 'head',
    }).first()
    expect(target?.attemptedAt).not.toBeNull()
    expect(target?.leaseUntil).toBeNull()
    expect(lookUp).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    const row = await db.orm.public.GithubSubscription.where({ id: subscription.id }).first()
    expect(row?.prNumber).toBeNull()
  })

  it('settles one target that threw and keeps sweeping the rest', async () => {
    const failing = await seedTarget(0, { repoFullName: 'compai/broken' })
    const lookUp = vi.fn<QueueDeps['lookUp']>(async (target) => {
      if (target.id === failing.id) throw new Error('socket hang up')
      return { outcome: ETargetOutcome.LookedUp }
    })
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    const others = [await seedTarget(1), await seedTarget(2)]

    await sweep(queueDeps({ lookUp, refresh }))

    expect(lookUp.mock.calls.map((call) => call[0].id)).toEqual([
      failing.id,
      ...others.map((row) => row.id),
    ])
    const row = await db.orm.public.GithubTrackingTarget.where({ id: failing.id }).first()
    expect(row?.failures).toBe(1)
    expect(row?.nextDueAt.getTime()).toBeGreaterThan(Date.now())
    expect(row?.leaseUntil).toBeNull()
  })

  it('refreshes a known pull request while every lookup is refused the budget', async () => {
    const lookUp = vi.fn<QueueDeps['lookUp']>(async () => ({
      outcome: ETargetOutcome.BudgetRefused,
    }))
    const refresh = vi.fn<QueueDeps['refresh']>(async () => ({ outcome: ETargetOutcome.Polled }))
    await seedTarget(0)
    const pull = await seedTarget(1, { kind: 'pull-request', prNumber: 42, lookedUpAt: new Date() })

    await sweep(queueDeps({ lookUp, refresh }))

    expect(refresh).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: POLLED_REPO,
      prNumber: 42,
    })
    const row = await db.orm.public.GithubTrackingTarget.where({ id: pull.id }).first()
    expect(row?.nextDueAt.getTime()).toBeGreaterThan(Date.now())
  })
})
