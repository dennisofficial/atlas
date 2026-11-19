import { beforeEach, describe, expect, it } from 'bun:test'

import type { ConformanceParams } from './conformance'
import { claimFixtureOf } from './conformance-claim-support'
import { T0 } from './support'

const SECOND = 1000

const after = (params: { from: string; ms: number }): string =>
  new Date(Date.parse(params.from) + params.ms).toISOString()

export function describeControlPlaneClaimCommands(params: ConformanceParams): void {
  describe(`ControlPlane claimNext input (${params.name})`, () => {
    const fixture = claimFixtureOf(params)
    let harness: ReturnType<typeof fixture.harness>

    beforeEach(async () => {
      await fixture.reset()
      harness = fixture.harness()
    })

    it('claims a released session once for a posted command, then stops until input arrives', async () => {
      await fixture.preparedSession('command-once')
      const hostId = await fixture.present()
      await harness.plane.post({ sessionId: 'command-once', kind: 'command:ghost', payload: '{}' })
      expect((await harness.plane.claimNext({ hostId, limit: 5 })).leases).toMatchObject([
        { sessionId: 'command-once', holderHostId: hostId, wantsHolder: false },
      ])
      await harness.plane.revoke({ sessionId: 'command-once', wantsHolder: false })
      harness.setNow(after({ from: T0, ms: 2 * SECOND }))
      expect((await harness.plane.claimNext({ hostId, limit: 5 })).leases).toEqual([])
      await harness.plane.post({ sessionId: 'command-once', kind: 'user', payload: '"hi"' })
      expect((await harness.plane.claimNext({ hostId, limit: 5 })).leases).toMatchObject([
        { sessionId: 'command-once', holderHostId: hostId },
      ])
      await fixture.releaseAll()
    })

    it('skips a session until its retryAfter passes and counts each claim', async () => {
      await fixture.newSession('retry')
      const first = await params.nextHostId()
      const releaseFirst = await params.holdPresence(first)
      const [claimed] = (await harness.plane.claimNext({ hostId: first, limit: 1 })).leases
      expect(claimed).toMatchObject({ attempts: 1, retryAfter: after({ from: T0, ms: SECOND }) })
      await harness.plane.revoke({ sessionId: 'retry', wantsHolder: true })
      const second = await fixture.present()
      expect((await harness.plane.claimNext({ hostId: second, limit: 1 })).leases).toEqual([])
      harness.setNow(after({ from: T0, ms: SECOND - 1 }))
      expect((await harness.plane.claimNext({ hostId: second, limit: 1 })).leases).toEqual([])
      const retryAt = after({ from: T0, ms: SECOND })
      harness.setNow(retryAt)
      const retried = (await harness.plane.claimNext({ hostId: second, limit: 1 })).leases
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
      await fixture.releaseAll()
    })

    it('reports the earliest future retryAfter of a gated session and claims it once the clock passes', async () => {
      await fixture.newSession('gated')
      const first = await params.nextHostId()
      const releaseFirst = await params.holdPresence(first)
      await harness.plane.claimNext({ hostId: first, limit: 1 })
      await harness.plane.revoke({ sessionId: 'gated', wantsHolder: true })
      const second = await fixture.present()
      const retryAt = after({ from: T0, ms: SECOND })
      expect(await harness.plane.claimNext({ hostId: second, limit: 1 })).toEqual({
        leases: [],
        nextRetryAt: retryAt,
      })
      harness.setNow(retryAt)
      const claimed = await harness.plane.claimNext({ hostId: second, limit: 1 })
      expect(claimed.leases).toMatchObject([{ sessionId: 'gated', holderHostId: second }])
      expect(claimed.nextRetryAt).toBeNull()
      await releaseFirst()
      await fixture.releaseAll()
    })

    it('reports no retry time when nothing needing a holder is gated', async () => {
      await fixture.newSession('free')
      const hostId = await fixture.present()
      expect((await harness.plane.claimNext({ hostId, limit: 5 })).nextRetryAt).toBeNull()
      expect(await harness.plane.claimNext({ hostId, limit: 5 })).toEqual({
        leases: [],
        nextRetryAt: null,
      })
      await fixture.releaseAll()
    })

    it('revoke keeps the retry state unless resetRetry is set', async () => {
      await fixture.newSession('keep')
      const hostId = await fixture.present()
      const [claimed] = (await harness.plane.claimNext({ hostId, limit: 1 })).leases
      const kept = await harness.plane.revoke({
        sessionId: 'keep',
        wantsHolder: true,
        epoch: claimed?.epoch ?? -1,
      })
      expect(kept).toMatchObject({
        ok: true,
        lease: { attempts: 1, retryAfter: after({ from: T0, ms: SECOND }) },
      })
      await fixture.releaseAll()
    })

    it('revoke with resetRetry clears attempts and retryAfter so the next claim is immediate', async () => {
      await fixture.newSession('reset')
      const hostId = await fixture.present()
      const [claimed] = (await harness.plane.claimNext({ hostId, limit: 1 })).leases
      const reset = await harness.plane.revoke({
        sessionId: 'reset',
        wantsHolder: true,
        epoch: claimed?.epoch ?? -1,
        resetRetry: true,
      })
      expect(reset).toMatchObject({ ok: true, lease: { attempts: 0, retryAfter: null } })
      const again = (await harness.plane.claimNext({ hostId, limit: 1 })).leases
      expect(again).toMatchObject([{ sessionId: 'reset', epoch: 3, attempts: 1 }])
      await fixture.releaseAll()
    })

    it('an unguarded revoke with resetRetry clears the retry state', async () => {
      await fixture.newSession('unguarded')
      const hostId = await fixture.present()
      await harness.plane.claimNext({ hostId, limit: 1 })
      const lease = await harness.plane.revoke({
        sessionId: 'unguarded',
        wantsHolder: false,
        resetRetry: true,
      })
      expect(lease).toMatchObject({ attempts: 0, retryAfter: null, holderHostId: null })
      await fixture.releaseAll()
    })
  })
}
