import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ensureUsers } from './testing/github-seed'
import { CLAIM_LEASE_MS, claimedTargets, releaseTarget, renewClaim } from './github-due-scheduler'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const LIVE_UNTIL = new Date(NOW + 6 * 60 * 60 * 1_000)

const seedTarget = (args: {
  branch: string
  nextDueAt: Date
  liveUntil?: Date
  leaseUntil?: Date | null
  failures?: number
}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: 'compai/app',
    branch: args.branch,
    prNumber: 0,
    lookedUpAt: null,
    attemptedAt: null,
    failures: args.failures ?? 0,
    leaseUntil: args.leaseUntil ?? null,
    nextDueAt: args.nextDueAt,
    liveUntil: args.liveUntil ?? LIVE_UNTIL,
  })

const branches = (rows: { branch: string }[]): string[] => rows.map((row) => row.branch).sort()

describe('claimedTargets', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('claims only what is due, oldest due first, and stamps the lease', async () => {
    await seedTarget({ branch: 'early', nextDueAt: new Date(NOW - 60_000) })
    await seedTarget({ branch: 'late', nextDueAt: new Date(NOW + 60_000) })

    const claimed = await claimedTargets({ now: new Date(NOW), limit: 10 })

    expect(branches(claimed)).toEqual(['early'])
    expect(claimed[0]?.leaseUntil?.getTime()).toBe(NOW + CLAIM_LEASE_MS)
    const held = await db.orm.public.GithubTrackingTarget.where({ branch: 'early' }).first()
    expect(held?.leaseUntil?.getTime()).toBe(NOW + CLAIM_LEASE_MS)
  })

  it('leaves a covered target parked at liveUntil out of the claim', async () => {
    await seedTarget({ branch: 'covered', nextDueAt: LIVE_UNTIL })
    await seedTarget({ branch: 'polled', nextDueAt: new Date(NOW - 1) })

    expect(branches(await claimedTargets({ now: new Date(NOW), limit: 1 }))).toEqual(['polled'])
  })

  it('serves every due target across sweeps instead of reselecting the oldest batch', async () => {
    for (let index = 0; index < 500; index += 1)
      await seedTarget({ branch: `b${index}`, nextDueAt: new Date(NOW - 1_000 + index) })

    const served = new Set<string>()
    for (let sweep = 0; sweep < 10; sweep += 1) {
      const claimed = await claimedTargets({ now: new Date(NOW), limit: 50 })
      for (const row of claimed) served.add(row.branch)
      const nextDueAt = new Date(NOW + 60_000)
      for (const row of claimed)
        await releaseTarget({
          id: row.id,
          leaseToken: row.leaseToken,
          attemptedAt: new Date(NOW),
          nextDueAt,
          failures: 0,
        })
    }

    expect(served.size).toBe(500)
  })

  it('reclaims a crashed sweep target once its lease runs out', async () => {
    const target = await seedTarget({ branch: 'crash', nextDueAt: new Date(NOW - 1), failures: 2 })

    expect(await claimedTargets({ now: new Date(NOW), limit: 10 })).toHaveLength(1)
    expect(
      branches(await claimedTargets({ now: new Date(NOW + CLAIM_LEASE_MS - 1), limit: 10 })),
    ).toEqual([])

    const reclaimed = await claimedTargets({
      now: new Date(NOW + CLAIM_LEASE_MS + 1),
      limit: 10,
    })

    expect(reclaimed.map((row) => row.id)).toEqual([target.id])
    expect(reclaimed[0]?.failures).toBe(2)
  })

  it('writes nothing back from a stale worker whose claim was taken over', async () => {
    const target = await seedTarget({ branch: 'taken', nextDueAt: new Date(NOW - 1) })
    const [stale] = await claimedTargets({ now: new Date(NOW), limit: 1 })
    const [fresh] = await claimedTargets({ now: new Date(NOW + CLAIM_LEASE_MS + 1), limit: 1 })
    expect(fresh?.id).toBe(target.id)

    const released = await releaseTarget({
      id: target.id,
      leaseToken: stale?.leaseToken ?? '',
      attemptedAt: new Date(NOW),
      nextDueAt: new Date(NOW + 60_000),
      failures: 3,
    })

    expect(released).toBe(0)
    const held = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(held?.failures).toBe(0)
    expect(held?.leaseToken).toBe(fresh?.leaseToken ?? '')
    expect(held?.leaseUntil?.getTime()).toBe(NOW + CLAIM_LEASE_MS + 1 + CLAIM_LEASE_MS)
  })

  it('renews only the claim whose token still holds the target', async () => {
    await seedTarget({ branch: 'renewed', nextDueAt: new Date(NOW - 1) })
    const [claimed] = await claimedTargets({ now: new Date(NOW), limit: 1 })
    const id = claimed?.id ?? ''

    expect(await renewClaim({ id, leaseToken: 'stale', now: new Date(NOW) })).toBe(0)
    expect(
      await renewClaim({ id, leaseToken: claimed?.leaseToken ?? '', now: new Date(NOW + 60_000) }),
    ).toBe(1)

    const held = await db.orm.public.GithubTrackingTarget.where({ id }).first()
    expect(held?.leaseUntil?.getTime()).toBe(NOW + 60_000 + CLAIM_LEASE_MS)
  })

  it('never hands one target to two concurrent sweeps', async () => {
    for (let index = 0; index < 10; index += 1)
      await seedTarget({ branch: `b${index}`, nextDueAt: new Date(NOW - 1) })

    const [first, second] = await Promise.all([
      claimedTargets({ now: new Date(NOW), limit: 10 }),
      claimedTargets({ now: new Date(NOW), limit: 10 }),
    ])

    const ids = [...first.map((row) => row.id), ...second.map((row) => row.id)]
    expect(new Set(ids).size).toBe(10)
    expect(ids).toHaveLength(10)
  })
})
