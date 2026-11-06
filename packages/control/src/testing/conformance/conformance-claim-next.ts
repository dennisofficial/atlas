import { beforeEach, describe, expect, it } from 'bun:test'

import { createSessionParams, makeHarness, T0, type Harness } from './support'
import type { ConformanceParams } from './conformance'

const SECOND = 1000

const after = (params: { from: string; ms: number }): string =>
  new Date(Date.parse(params.from) + params.ms).toISOString()

export function describeControlPlaneClaimNext(params: ConformanceParams): void {
  describe(`ControlPlane claimNext (${params.name})`, () => {
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

    const releaseAll = async (): Promise<void> => {
      for (const release of releases.splice(0)) await release()
    }

    const newSession = async (sessionId: string): Promise<void> => {
      await harness.plane.createSession(
        createSessionParams({ sessionId, mainThreadId: `${sessionId}-thread` }),
      )
    }

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
      const first = await harness.plane.claimNext({ hostId, limit: 5 })
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
      expect(await harness.plane.claimNext({ hostId, limit: 5 })).toEqual([])
      const current = await harness.plane.currentLease({ sessionId: 'fresh' })
      expect(current).toMatchObject({ live: true, lease: { epoch: 1, holderHostId: hostId } })
      await releaseAll()
    })

    it('skips a session held by a present host', async () => {
      await newSession('held')
      const owner = await present()
      const other = await present()
      await harness.plane.grant({ sessionId: 'held', hostId: owner })
      expect(await harness.plane.claimNext({ hostId: other, limit: 5 })).toEqual([])
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
      expect(await harness.plane.claimNext({ hostId, limit: 5 })).toEqual([])
      await releaseGone()
      const taken = await harness.plane.claimNext({ hostId, limit: 5 })
      expect(taken).toMatchObject([{ sessionId: 'orphan', epoch: 2, holderHostId: hostId }])
      await releaseAll()
    })

    it('skips a session until its retryAfter passes and counts each claim', async () => {
      await newSession('retry')
      const first = await params.nextHostId()
      const releaseFirst = await params.holdPresence(first)
      const [claimed] = await harness.plane.claimNext({ hostId: first, limit: 1 })
      expect(claimed).toMatchObject({ attempts: 1, retryAfter: after({ from: T0, ms: SECOND }) })
      await harness.plane.revoke({ sessionId: 'retry', wantsHolder: true })
      const second = await present()
      expect(await harness.plane.claimNext({ hostId: second, limit: 1 })).toEqual([])
      harness.setNow(after({ from: T0, ms: SECOND - 1 }))
      expect(await harness.plane.claimNext({ hostId: second, limit: 1 })).toEqual([])
      const retryAt = after({ from: T0, ms: SECOND })
      harness.setNow(retryAt)
      const retried = await harness.plane.claimNext({ hostId: second, limit: 1 })
      expect(retried).toMatchObject([
        {
          sessionId: 'retry',
          epoch: 3,
          holderHostId: second,
          attempts: 2,
          retryAfter: after({ from: retryAt, ms: 2 * SECOND }),
        },
      ])
      await releaseFirst()
      await releaseAll()
    })

    it('revoke keeps the retry state unless resetRetry is set', async () => {
      await newSession('keep')
      const hostId = await present()
      const [claimed] = await harness.plane.claimNext({ hostId, limit: 1 })
      const kept = await harness.plane.revoke({
        sessionId: 'keep',
        wantsHolder: true,
        epoch: claimed?.epoch ?? -1,
      })
      expect(kept).toMatchObject({
        ok: true,
        lease: { attempts: 1, retryAfter: after({ from: T0, ms: SECOND }) },
      })
      await releaseAll()
    })

    it('revoke with resetRetry clears attempts and retryAfter so the next claim is immediate', async () => {
      await newSession('reset')
      const hostId = await present()
      const [claimed] = await harness.plane.claimNext({ hostId, limit: 1 })
      const reset = await harness.plane.revoke({
        sessionId: 'reset',
        wantsHolder: true,
        epoch: claimed?.epoch ?? -1,
        resetRetry: true,
      })
      expect(reset).toMatchObject({ ok: true, lease: { attempts: 0, retryAfter: null } })
      const again = await harness.plane.claimNext({ hostId, limit: 1 })
      expect(again).toMatchObject([{ sessionId: 'reset', epoch: 3, attempts: 1 }])
      await releaseAll()
    })

    it('a stale-epoch revoke with resetRetry changes nothing', async () => {
      await newSession('stale')
      const hostId = await present()
      const [claimed] = await harness.plane.claimNext({ hostId, limit: 1 })
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

    it('an unguarded revoke with resetRetry clears the retry state', async () => {
      await newSession('unguarded')
      const hostId = await present()
      await harness.plane.claimNext({ hostId, limit: 1 })
      const lease = await harness.plane.revoke({
        sessionId: 'unguarded',
        wantsHolder: false,
        resetRetry: true,
      })
      expect(lease).toMatchObject({ attempts: 0, retryAfter: null, holderHostId: null })
      await releaseAll()
    })

    it('claims nothing for a host that is not present', async () => {
      await newSession('absent-self')
      const absent = await params.nextHostId()
      expect(await harness.plane.claimNext({ hostId: absent, limit: 5 })).toEqual([])
      expect((await harness.plane.currentLease({ sessionId: 'absent-self' })).lease).toMatchObject({
        epoch: 0,
        attempts: 0,
        holderHostId: null,
      })
    })

    it('returns nothing for a limit of zero or less', async () => {
      await newSession('zero')
      const hostId = await present()
      expect(await harness.plane.claimNext({ hostId, limit: 0 })).toEqual([])
      expect(await harness.plane.claimNext({ hostId, limit: -3 })).toEqual([])
      expect((await harness.plane.currentLease({ sessionId: 'zero' })).lease.epoch).toBe(0)
      await releaseAll()
    })

    it('takes at most limit sessions, oldest first', async () => {
      for (const [index, sessionId] of ['limit-a', 'limit-b', 'limit-c'].entries()) {
        harness.setNow(after({ from: T0, ms: index * SECOND }))
        await newSession(sessionId)
      }
      const hostId = await present()
      const taken = await harness.plane.claimNext({ hostId, limit: 2 })
      expect(taken.map((lease) => lease.sessionId)).toEqual(['limit-a', 'limit-b'])
      const rest = await harness.plane.claimNext({ hostId, limit: 2 })
      expect(rest.map((lease) => lease.sessionId)).toEqual(['limit-c'])
      await releaseAll()
    })
  })
}
