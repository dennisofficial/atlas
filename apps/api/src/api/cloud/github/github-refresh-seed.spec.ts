import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedSubscription } from '../../../../test/github-seed'
import { seedSubscriptionTargets } from './github-refresh-seed'
import type { TransportSelector } from './github-transport-selector'

const polling = {
  polls: async () => true,
} as unknown as TransportSelector

const headTargets = () => db.orm.public.GithubTrackingTarget.where({ kind: 'head' }).all()

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
})
