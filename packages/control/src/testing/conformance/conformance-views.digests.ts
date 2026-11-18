import { beforeEach, describe, expect, it } from 'bun:test'

import type { ConformanceParams } from './conformance'
import { branches, prStateOf } from './conformance-views.fixture'
import {
  appendBodies,
  makeHarness,
  said,
  seedGranted,
  SESSION,
  THREAD,
  type Harness,
} from './support'

export function describeControlPlaneDigests(params: ConformanceParams): void {
  describe(`ControlPlane session digests (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    const seedPr = async (row: ReturnType<typeof prStateOf>): Promise<void> => {
      const seed = params.seedPrState
      if (seed === undefined) throw new Error('the harness seeds no pull request state')
      await seed(row)
    }

    it('lists digests with the view', async () => {
      await seedPr(prStateOf({ number: 7, state: 'open', updatedAt: '2026-11-02T12:00:00.000Z' }))
      await appendBodies({ harness, epoch, bodies: [said('a'), branches] })
      const [bare] = await harness.plane.listSessionDigests({ userId: 'user-1', limit: 10 })
      expect(bare?.view).toBeNull()
      const [digest] = await harness.plane.listSessionDigests({
        userId: 'user-1',
        limit: 10,
        withView: true,
      })
      expect(digest?.view?.primaryBranch).toBe('feat')
      expect(digest?.view?.pullRequest).toMatchObject({
        repo: 'acme/app',
        number: 7,
        state: 'open',
      })
    })
  })
}
