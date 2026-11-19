import { beforeEach, describe, expect, it } from 'bun:test'

import type { ConformanceParams } from './conformance'
import { claimFixtureOf } from './conformance-claim-support'
import { T0 } from './support'

const SECOND = 1000

const after = (params: { from: string; ms: number }): string =>
  new Date(Date.parse(params.from) + params.ms).toISOString()

export function describeControlPlaneClaimNext(params: ConformanceParams): void {
  describe(`ControlPlane claimNext (${params.name})`, () => {
    const fixture = claimFixtureOf(params)
    let harness: ReturnType<typeof fixture.harness>

    beforeEach(async () => {
      await fixture.reset()
      harness = fixture.harness()
    })

    const present = (): Promise<number> => fixture.present()
    const releaseAll = (): Promise<void> => fixture.releaseAll()
    const newSession = (sessionId: string): Promise<void> => fixture.newSession(sessionId)

    it('createSession creates the lease row with the session', async () => {
      await newSession('born')
      const row = await params.makeStore().transact((tx) => tx.readLease('born'))
      expect(row).toEqual({
        sessionId: 'born',
        epoch: 0,
        holderHostId: null,
        wantsHolder: false,
        attempts: 0,
        retryAfter: null,
      })
    })

    it('takes a fresh session once', async () => {
      await newSession('fresh')
      const hostId = await present()
      const first = (await harness.plane.claimNext({ hostId, limit: 5 })).leases
      expect(first).toEqual([
        {
          sessionId: 'fresh',
          epoch: 1,
          holderHostId: hostId,
          wantsHolder: false,
          attempts: 1,
          retryAfter: after({ from: T0, ms: SECOND }),
        },
      ])
      expect((await harness.plane.claimNext({ hostId, limit: 5 })).leases).toEqual([])
      const current = await harness.plane.currentLease({ sessionId: 'fresh' })
      expect(current).toMatchObject({ live: true, lease: { epoch: 1, holderHostId: hostId } })
      await releaseAll()
    })

    it('skips a session held by a present host', async () => {
      await newSession('held')
      const owner = await present()
      const other = await present()
      await harness.plane.grant({ sessionId: 'held', hostId: owner })
      expect((await harness.plane.claimNext({ hostId: other, limit: 5 })).leases).toEqual([])
      expect((await harness.plane.currentLease({ sessionId: 'held' })).lease.holderHostId).toBe(
        owner,
      )
      await releaseAll()
    })

    it('takes a session whose holder is absent', async () => {
      await newSession('orphan')
      const gone = await params.nextHostId()
      const releaseGone = await params.holdPresence(gone)
      await harness.plane.grant({ sessionId: 'orphan', hostId: gone })
      const hostId = await present()
      expect((await harness.plane.claimNext({ hostId, limit: 5 })).leases).toEqual([])
      await releaseGone()
      const taken = (await harness.plane.claimNext({ hostId, limit: 5 })).leases
      expect(taken).toMatchObject([{ sessionId: 'orphan', epoch: 2, holderHostId: hostId }])
      await releaseAll()
    })

    it('clearStartAttempts forgets failed starts without moving the lease', async () => {
      await newSession('healthy')
      const hostId = await present()
      const [claimed] = (await harness.plane.claimNext({ hostId, limit: 1 })).leases
      const cleared = await harness.plane.clearStartAttempts({
        sessionId: 'healthy',
        epoch: claimed?.epoch ?? -1,
      })
      expect(cleared).toMatchObject({
        ok: true,
        lease: { epoch: claimed?.epoch ?? -2, holderHostId: hostId, attempts: 0, retryAfter: null },
      })
      expect((await harness.plane.currentLease({ sessionId: 'healthy' })).lease).toMatchObject({
        epoch: claimed?.epoch ?? -2,
        holderHostId: hostId,
        attempts: 0,
        retryAfter: null,
      })
      await releaseAll()
    })

    it('clearStartAttempts changes nothing for a stale epoch', async () => {
      await newSession('stale-clear')
      const hostId = await present()
      const [claimed] = (await harness.plane.claimNext({ hostId, limit: 1 })).leases
      const stale = await harness.plane.clearStartAttempts({
        sessionId: 'stale-clear',
        epoch: (claimed?.epoch ?? 0) + 1,
      })
      expect(stale).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 1 } })
      expect((await harness.plane.currentLease({ sessionId: 'stale-clear' })).lease).toMatchObject({
        attempts: 1,
        holderHostId: hostId,
      })
      await releaseAll()
    })

    it('a revoke at the epoch a fenced holder held lets the next claim mint a higher epoch', async () => {
      await newSession('fenced')
      const first = await present()
      const [claimed] = (await harness.plane.claimNext({ hostId: first, limit: 1 })).leases
      const heldEpoch = claimed?.epoch ?? -1
      const settled = await harness.plane.revoke({
        sessionId: 'fenced',
        wantsHolder: true,
        epoch: heldEpoch,
      })
      expect(settled).toMatchObject({
        ok: true,
        lease: { epoch: heldEpoch + 1, holderHostId: null, wantsHolder: true },
      })
      harness.setNow(after({ from: T0, ms: SECOND }))
      const second = await present()
      const reclaimed = (await harness.plane.claimNext({ hostId: second, limit: 1 })).leases
      expect(reclaimed).toMatchObject([{ sessionId: 'fenced', holderHostId: second }])
      expect(reclaimed[0]?.epoch ?? -1).toBeGreaterThan(heldEpoch)
      await releaseAll()
    })

    it('a stale-epoch revoke with resetRetry changes nothing', async () => {
      await newSession('stale')
      const hostId = await present()
      const [claimed] = (await harness.plane.claimNext({ hostId, limit: 1 })).leases
      const stale = await harness.plane.revoke({
        sessionId: 'stale',
        wantsHolder: true,
        epoch: (claimed?.epoch ?? 0) + 1,
        resetRetry: true,
      })
      expect(stale).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 1 } })
      expect((await harness.plane.currentLease({ sessionId: 'stale' })).lease).toMatchObject({
        attempts: 1,
        holderHostId: hostId,
      })
      await releaseAll()
    })

    it('claims nothing for a host that is not present', async () => {
      await newSession('absent-self')
      const absent = await params.nextHostId()
      expect((await harness.plane.claimNext({ hostId: absent, limit: 5 })).leases).toEqual([])
      expect((await harness.plane.currentLease({ sessionId: 'absent-self' })).lease).toMatchObject({
        epoch: 0,
        attempts: 0,
        holderHostId: null,
      })
    })

    it('returns nothing for a limit of zero or less', async () => {
      await newSession('zero')
      const hostId = await present()
      expect((await harness.plane.claimNext({ hostId, limit: 0 })).leases).toEqual([])
      expect((await harness.plane.claimNext({ hostId, limit: -3 })).leases).toEqual([])
      expect((await harness.plane.currentLease({ sessionId: 'zero' })).lease.epoch).toBe(0)
      await releaseAll()
    })

    it('takes at most limit sessions, oldest first', async () => {
      for (const [index, sessionId] of ['limit-a', 'limit-b', 'limit-c'].entries()) {
        harness.setNow(after({ from: T0, ms: index * SECOND }))
        await newSession(sessionId)
      }
      const hostId = await present()
      const taken = (await harness.plane.claimNext({ hostId, limit: 2 })).leases
      expect(taken.map((lease) => lease.sessionId)).toEqual(['limit-a', 'limit-b'])
      const rest = (await harness.plane.claimNext({ hostId, limit: 2 })).leases
      expect(rest.map((lease) => lease.sessionId)).toEqual(['limit-c'])
      await releaseAll()
    })
  })
}
