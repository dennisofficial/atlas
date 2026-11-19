import { beforeEach, describe, expect, it } from 'bun:test'
import { chainHash } from '@dltech/atlas-core'

import { emptyDigestTimings } from '../../session-digest-view'
import { toStoredEvent } from '../../stored-event'
import type { ConformanceParams } from './conformance'
import { branches, prStateOf } from './conformance-views.fixture'
import { appendBodies, makeHarness, mint, said, seedGranted, THREAD, type Harness } from './support'

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

    const appendBehindTheView = async (): Promise<void> => {
      const head = await harness.plane.head({ threadId: THREAD })
      const events = mint({ bodies: [said('b')], epoch, from: head })
      const last = events[events.length - 1]
      if (last === undefined) throw new Error('no events to insert')
      await params.makeStore().transact(async (tx) => {
        const row = await tx.lockThread(THREAD)
        if (row === undefined) throw new Error('missing main thread')
        await tx.insertEvents(
          events.map((event) => toStoredEvent({ event, hash: chainHash(event) })),
        )
        await tx.writeThreadHead({
          threadId: THREAD,
          expectedHeadSeq: row.headSeq,
          headSeq: last.seq,
          headHash: chainHash(last),
          visibility: row.visibility,
        })
      })
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

    it('times the digest phases and counts stale rows', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), branches] })
      await appendBehindTheView()

      const stale = emptyDigestTimings()
      const [digest] = await harness.plane.listSessionDigests({
        userId: 'user-1',
        limit: 10,
        withView: true,
        timings: stale,
      })
      expect(digest?.view?.primaryBranch).toBe('feat')
      expect(stale.staleRows).toBe(1)
      expect(stale.staleMs).toBeGreaterThanOrEqual(0)
      expect(stale.phases.digestRowsMs).toBeGreaterThanOrEqual(0)
      expect(stale.phases.threadsMs).toBeGreaterThanOrEqual(0)
      expect(stale.phases.viewsMs).toBeGreaterThanOrEqual(0)
      expect(stale.phases.leasesMs).toBeGreaterThanOrEqual(0)
      expect(stale.phases.pullRequestsMs).toBeGreaterThanOrEqual(0)
      expect(stale.phases.rowsMs).toBeGreaterThanOrEqual(0)

      const fresh = emptyDigestTimings()
      await harness.plane.listSessionDigests({
        userId: 'user-1',
        limit: 10,
        withView: true,
        timings: fresh,
      })
      expect(fresh.staleRows).toBe(0)
      expect(fresh.staleMs).toBe(0)
    })

  })
}
