import { beforeEach, describe, expect, it } from 'bun:test'

import { LeaseConflictError } from '../../errors'
import { createSessionParams, makeHarness, T0, type Harness } from './support'
import type { ConformanceParams } from './conformance'

export function describeControlPlaneClaims(params: ConformanceParams): void {
  describe(`ControlPlane claims (${params.name})`, () => {
    let harness: Harness

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
    })

    it('claim takes a fresh session and refuses a live lease', async () => {
      const sessionId = 'claim-live'
      await harness.plane.createSession(
        createSessionParams({ sessionId, mainThreadId: `${sessionId}-thread` }),
      )
      const won = await harness.plane.claim({ sessionId, holderId: 'pod-1', ttlMs: 60_000 })
      expect(won.ok).toBe(true)
      if (won.ok) expect(won.lease).toMatchObject({ epoch: 1, holderId: 'pod-1' })
      const refused = await harness.plane.claim({ sessionId, holderId: 'pod-2', ttlMs: 60_000 })
      expect(refused).toEqual({ ok: false, refusal: { kind: 'held', epoch: 1 } })
    })

    it('claim takes an expired lease at epoch+1, and a revoked one', async () => {
      const sessionId = 'claim-expired'
      await harness.plane.createSession(
        createSessionParams({ sessionId, mainThreadId: `${sessionId}-thread` }),
      )
      await harness.plane.grant({ sessionId, holderId: 'pod-old', ttlMs: 30_000 })
      harness.setNow('2026-11-02T12:01:00.000Z')
      const won = await harness.plane.claim({ sessionId, holderId: 'pod-new', ttlMs: 60_000 })
      expect(won.ok).toBe(true)
      if (won.ok) expect(won.lease).toMatchObject({ epoch: 2, holderId: 'pod-new' })
      const revoked = await harness.plane.revoke({ sessionId, wantsHolder: true })
      expect(revoked.epoch).toBe(3)
      const again = await harness.plane.claim({ sessionId, holderId: 'pod-next', ttlMs: 60_000 })
      expect(again.ok).toBe(true)
      if (again.ok) expect(again.lease.epoch).toBe(4)
      harness.setNow(T0)
    })

    it('eight concurrent claims produce exactly one winner', async () => {
      for (let round = 0; round < 5; round += 1) {
        const sessionId = `claim-race-${round}`
        await harness.plane.createSession(
          createSessionParams({ sessionId, mainThreadId: `${sessionId}-thread` }),
        )
        const settled = await Promise.allSettled(
          Array.from({ length: 8 }, (_, i) =>
            harness.plane.claim({ sessionId, holderId: `pod-${i}`, ttlMs: 60_000 }),
          ),
        )
        const won = settled.filter(
          (r) => r.status === 'fulfilled' && r.value.ok,
        ) as PromiseFulfilledResult<
          Extract<Awaited<ReturnType<typeof harness.plane.claim>>, { ok: true }>
        >[]
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
      }
    })
  })
}
