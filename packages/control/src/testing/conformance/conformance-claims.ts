import { beforeEach, describe, expect, it } from 'bun:test'

import { LeaseConflictError } from '../../errors'
import { createSessionParams, HOLDER_HOST, makeHarness, type Harness } from './support'
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

    it('claim takes a fresh session and refuses while the holder is present', async () => {
      const sessionId = 'claim-live'
      await newSession(sessionId)
      const first = await present()
      const second = await present()
      const won = await harness.plane.claim({ sessionId, hostId: first })
      expect(won.ok).toBe(true)
      if (won.ok) expect(won.lease).toMatchObject({ epoch: 1, holderHostId: first })
      const refused = await harness.plane.claim({ sessionId, hostId: second })
      expect(refused).toEqual({ ok: false, refusal: { kind: 'held', epoch: 1 } })
      await releaseAll()
    })

    it('claim refuses while the holder is present and takes over once it is absent', async () => {
      const sessionId = 'claim-takeover'
      await newSession(sessionId)
      const oldHost = await params.nextHostId()
      const releaseOld = await params.holdPresence(oldHost)
      await harness.plane.grant({ sessionId, hostId: oldHost })
      const newHost = await present()
      expect(await harness.plane.claim({ sessionId, hostId: newHost })).toEqual({
        ok: false,
        refusal: { kind: 'held', epoch: 1 },
      })
      await releaseOld()
      const won = await harness.plane.claim({ sessionId, hostId: newHost })
      expect(won.ok).toBe(true)
      if (won.ok) expect(won.lease).toMatchObject({ epoch: 2, holderHostId: newHost })
      const revoked = await harness.plane.revoke({ sessionId, wantsHolder: true })
      expect(revoked.epoch).toBe(3)
      const again = await harness.plane.claim({ sessionId, hostId: newHost })
      expect(again.ok).toBe(true)
      if (again.ok) expect(again.lease.epoch).toBe(4)
      await releaseAll()
    })

    it('a claimer that is not present is refused', async () => {
      const sessionId = 'claim-absent'
      await newSession(sessionId)
      const absent = await params.nextHostId()
      expect(await harness.plane.claim({ sessionId, hostId: absent })).toEqual({
        ok: false,
        refusal: { kind: 'not-present' },
      })
      expect((await harness.plane.currentLease({ sessionId })).lease.epoch).toBe(0)
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

    it('eight concurrent claims produce exactly one winner', async () => {
      for (let round = 0; round < 5; round += 1) {
        const sessionId = `claim-race-${round}`
        await newSession(sessionId)
        const hosts = await Promise.all(Array.from({ length: 8 }, present))
        const settled = await Promise.allSettled(
          hosts.map((hostId) => harness.plane.claim({ sessionId, hostId })),
        )
        const won = settled.filter((r) => r.status === 'fulfilled' && r.value.ok)
        expect(won.length).toBe(1)
        for (const r of settled) {
          if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(LeaseConflictError)
          if (r.status === 'fulfilled' && !r.value.ok) {
            expect(r.value.refusal).toEqual({ kind: 'held', epoch: 1 })
          }
        }
        const current = await harness.plane.currentLease({ sessionId })
        expect(current.lease.epoch).toBe(1)
        expect(current.live).toBe(true)
        await releaseAll()
      }
    })
  })
}
