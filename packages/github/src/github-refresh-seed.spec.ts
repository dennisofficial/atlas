import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedSubscription } from './testing/github-seed'
import { seedSubscriptionTargets } from './github-refresh-seed'
import type { TransportSelector } from './github-transport-selector'

const polling = {
  polls: async () => true,
} as unknown as TransportSelector

const headTargets = () => db.orm.public.GithubTrackingTarget.where({ kind: 'head' }).all()

const headTarget = async () => {
  const [row] = await headTargets()
  if (row === undefined) throw new Error('no head target')
  return row
}

const rowVersionOf = async (id: string): Promise<string> => {
  const rows = await db.query(
    db.raw.sql`SELECT xmin::text AS xmin FROM "GithubTrackingTarget" WHERE id = ${id}`
      .returnsRow({ xmin: 'pg/text@1' })
      .build(),
  )
  return rows[0]?.xmin ?? ''
}

const hourFromNow = (hours = 1): Date => new Date(Date.now() + hours * 60 * 60_000)

describe('seedSubscriptionTargets', () => {
  useTestDatabase()

  it('seeds a head target for a branch subscription', async () => {
    await seedSubscription({ pollBacked: true, branch: 'dennis/fix', prNumber: null })

    await seedSubscriptionTargets({ transport: polling, now: new Date() })

    expect(await headTargets()).toHaveLength(1)
  })

  it('seeds no head target for a workflow selector branch', async () => {
    await seedSubscription({
      kind: 'workflow-run',
      pollBacked: true,
      branch: '#workflow:ci.yml@main',
      prNumber: null,
    })

    await seedSubscriptionTargets({ transport: polling, now: new Date() })

    expect(await headTargets()).toHaveLength(0)
  })

  it('leaves the head target row version alone when its liveUntil is unchanged', async () => {
    const liveUntil = hourFromNow()
    await seedSubscription({ pollBacked: true, branch: 'dennis/fix', prNumber: null, liveUntil })
    await seedSubscriptionTargets({ transport: polling, now: new Date() })
    const seeded = await headTarget()
    const version = await rowVersionOf(seeded.id)

    await seedSubscriptionTargets({ transport: polling, now: new Date() })

    const repeated = await headTarget()
    expect(repeated.id).toBe(seeded.id)
    expect(repeated.liveUntil.getTime()).toBe(liveUntil.getTime())
    expect(await rowVersionOf(repeated.id)).toBe(version)
  })

  it('updates the head target when the subscription liveUntil moved', async () => {
    const subscription = await seedSubscription({
      pollBacked: true,
      branch: 'dennis/fix',
      prNumber: null,
      liveUntil: hourFromNow(),
    })
    await seedSubscriptionTargets({ transport: polling, now: new Date() })
    const seeded = await headTarget()
    const version = await rowVersionOf(seeded.id)

    const moved = hourFromNow(2)
    await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({
      liveUntil: moved,
    })
    await seedSubscriptionTargets({ transport: polling, now: new Date() })

    const repeated = await headTarget()
    expect(repeated.id).toBe(seeded.id)
    expect(repeated.liveUntil.getTime()).toBe(moved.getTime())
    expect(await rowVersionOf(repeated.id)).not.toBe(version)
  })

  it('leaves the numbered target row version alone when its liveUntil is unchanged', async () => {
    const liveUntil = hourFromNow()
    await seedSubscription({ prNumber: 42, branch: '', liveUntil })
    await seedSubscriptionTargets({ transport: polling, now: new Date() })
    const [seeded] = await db.orm.public.GithubTrackingTarget.where({ prNumber: 42 }).all()
    if (seeded === undefined) throw new Error('no numbered target')
    const version = await rowVersionOf(seeded.id)

    await seedSubscriptionTargets({ transport: polling, now: new Date() })

    const [repeated] = await db.orm.public.GithubTrackingTarget.where({ prNumber: 42 }).all()
    expect(repeated?.id).toBe(seeded.id)
    expect(await rowVersionOf(seeded.id)).toBe(version)
  })
})
