import { beforeEach, describe, expect, it } from 'bun:test'

import { LeaseConflictError } from '../../errors'
import { createSessionParams, HOLDER_HOST, makeHarness, T0, type Harness } from './support'
import type { ConformanceParams } from './conformance'

export function describeControlPlaneClaims(params: ConformanceParams): void {
  describe(`ControlPlane claims (${params.name})`, () => {
    let harness: Harness
    const releases: (() => Promise<void>)[] = []

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
    })

    const present = async (): Promise<number> => {
      const hostId = await params.nextHostId()
      releases.push(await params.holdPresence(hostId))
      return hostId
    }

    const newSession = async (sessionId: string): Promise<void> => {
      await harness.plane.createSession(
        createSessionParams({ sessionId, mainThreadId: `${sessionId}-thread` }),
      )
    }

    const releaseAll = async (): Promise<void> => {
      for (const release of releases.splice(0)) await release()
    }

    it('claimNext gives a fresh session to one of two present hosts and the other gets nothing', async () => {
      const sessionId = 'claim-live'
      await newSession(sessionId)
      const first = await present()
      const second = await present()
      const won = (await harness.plane.claimNext({ hostId: first, limit: 5 })).leases
      expect(won).toMatchObject([{ sessionId, epoch: 1, holderHostId: first }])
      expect((await harness.plane.claimNext({ hostId: second, limit: 5 })).leases).toEqual([])
      await releaseAll()
    })

    it('claimNext skips a held session and takes it over once the holder is absent', async () => {
      const sessionId = 'claim-takeover'
      await newSession(sessionId)
      const oldHost = await params.nextHostId()
      const releaseOld = await params.holdPresence(oldHost)
      await harness.plane.grant({ sessionId, hostId: oldHost })
      const newHost = await present()
      expect((await harness.plane.claimNext({ hostId: newHost, limit: 5 })).leases).toEqual([])
      await releaseOld()
      const won = (await harness.plane.claimNext({ hostId: newHost, limit: 5 })).leases
      expect(won).toMatchObject([{ sessionId, epoch: 2, holderHostId: newHost }])
      const revoked = await harness.plane.revoke({ sessionId, wantsHolder: true })
      expect(revoked.epoch).toBe(3)
      harness.setNow(new Date(Date.parse(T0) + 2000).toISOString())
      const again = (await harness.plane.claimNext({ hostId: newHost, limit: 5 })).leases
      expect(again).toMatchObject([{ sessionId, epoch: 4 }])
      await releaseAll()
    })

    it('currentLease.live follows presence', async () => {
      const sessionId = 'claim-live-follows'
      await newSession(sessionId)
      expect((await harness.plane.currentLease({ sessionId })).live).toBe(false)
      const hostId = await params.nextHostId()
      const release = await params.holdPresence(hostId)
      await harness.plane.grant({ sessionId, hostId })
      expect((await harness.plane.currentLease({ sessionId })).live).toBe(true)
      await release()
      const after = await harness.plane.currentLease({ sessionId })
      expect(after.live).toBe(false)
      expect(after.lease.holderHostId).toBe(hostId)
    })

    it('concurrent first grants on one session fail only with LeaseConflictError', async () => {
      for (let round = 0; round < 5; round += 1) {
        const sessionId = `race-${round}`
        await harness.plane.createSession(
          createSessionParams({
            sessionId,
            mainThreadId: `race-thread-${round}`,
          }),
        )
        const settled = await Promise.allSettled(
          Array.from({ length: 8 }, (_, i) =>
            harness.plane.grant({ sessionId, hostId: HOLDER_HOST }),
          ),
        )
        const won = settled.filter((r) => r.status === 'fulfilled')
        expect(won.length).toBeGreaterThanOrEqual(1)
        for (const r of settled) {
          if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(LeaseConflictError)
        }
        const current = await harness.plane.currentLease({ sessionId })
        expect(current.lease.epoch).toBe(won.length)
      }
    })

    it('leasesHeldBy lists only that host leases in session order and respects the limit', async () => {
      const mine = await present()
      const other = await present()
      for (const sessionId of ['held-c', 'held-a', 'held-b', 'held-other']) {
        await newSession(sessionId)
      }
      for (const sessionId of ['held-c', 'held-a', 'held-b']) {
        await harness.plane.grant({ sessionId, hostId: mine })
      }
      await harness.plane.grant({ sessionId: 'held-other', hostId: other })
      const all = await harness.plane.leasesHeldBy({ hostId: mine, limit: 100 })
      expect(all.map((lease) => lease.sessionId)).toEqual(['held-a', 'held-b', 'held-c'])
      expect(all.every((lease) => lease.holderHostId === mine)).toBe(true)
      const limited = await harness.plane.leasesHeldBy({ hostId: mine, limit: 2 })
      expect(limited.map((lease) => lease.sessionId)).toEqual(['held-a', 'held-b'])
      expect(await harness.plane.leasesHeldBy({ hostId: other, limit: 100 })).toHaveLength(1)
      await releaseAll()
    })

    it('eight concurrent claimNext calls produce exactly one winner', async () => {
      for (let round = 0; round < 5; round += 1) {
        const sessionId = `claim-race-${round}`
        await newSession(sessionId)
        const hosts = await Promise.all(Array.from({ length: 8 }, present))
        const settled = await Promise.all(
          hosts.map((hostId) => harness.plane.claimNext({ hostId, limit: 5 })),
        )
        const won = settled
          .flatMap((batch) => batch.leases)
          .filter((lease) => lease.sessionId === sessionId)
        expect(won).toHaveLength(1)
        const current = await harness.plane.currentLease({ sessionId })
        expect(current.lease.epoch).toBe(1)
        expect(current.live).toBe(true)
        await releaseAll()
      }
    })
  })
}
