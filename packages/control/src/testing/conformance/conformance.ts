import { beforeEach, describe, expect, it } from 'bun:test'
import { visibleEvents, ECompactionAnchor, type V2Body } from '@dltech/atlas-core'

import { LeaseConflictError } from '../../errors'
import type { ControlStorePort } from '../../port'
import {
  appendBodies,
  HOLDER,
  makeHarness,
  mint,
  PROJECT,
  readAll,
  said,
  seedGranted,
  SESSION,
  T0,
  THREAD,
  USER,
  createSessionParams,
  type Harness,
} from './support'

export type ConformanceParams = {
  name: string
  makeStore: () => ControlStorePort
  reset: () => Promise<void>
}

const consumed = (inboxId: number): V2Body => ({ type: 'input-consumed', inboxId })

export function describeControlPlaneConformance(params: ConformanceParams): void {
  describe(`ControlPlane conformance (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    const seedTo = async (target: number) => {
      while ((await harness.plane.head({ threadId: THREAD })).seq < target) {
        const seq = (await harness.plane.head({ threadId: THREAD })).seq
        const count = Math.min(50, target - seq)
        await appendBodies({
          harness,
          epoch,
          bodies: Array.from({ length: count }, (_, i) => said(`m${seq + i}`)),
        })
      }
    }

    it('seq-466 interleaving: posts, holder consumes, second writer refused', async () => {
      await seedTo(465)
      const first = await harness.plane.post({ sessionId: SESSION, kind: 'user', payload: '"a"' })
      const second = await harness.plane.post({ sessionId: SESSION, kind: 'user', payload: '"b"' })
      expect([first.inboxId, second.inboxId]).toEqual([1, 2])
      const head = await harness.plane.head({ threadId: THREAD })
      const holder = mint({ bodies: [consumed(1), consumed(2)], epoch, from: head })
      const rival = mint({ bodies: [said('rival')], epoch, from: head })
      const won = await harness.plane.append({ threadId: THREAD, epoch, events: holder })
      expect(won.ok).toBe(true)
      expect(won.head.seq).toBe(467)
      const lost = await harness.plane.append({ threadId: THREAD, epoch, events: rival })
      expect(lost).toMatchObject({ ok: false, refusal: { kind: 'seq-mismatch', expected: 468 } })
      expect(lost.head.seq).toBe(467)
      expect(await harness.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual(
        [],
      )
      expect(await harness.plane.takeBack({ sessionId: SESSION, inboxId: 1 })).toEqual({
        ok: false,
        refusal: { kind: 'already-consumed' },
      })
    })

    it('refuses a write at a stale epoch after the lease moves', async () => {
      const events = mint({ bodies: [said('x')], epoch })
      await harness.plane.grant({ sessionId: SESSION, holderId: 'pod-b', ttlMs: 60_000 })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events })
      expect(outcome).toMatchObject({
        ok: false,
        refusal: { kind: 'stale-epoch', current: epoch + 1 },
      })
      expect(outcome.head.seq).toBe(0)
    })

    it('refuses an append on a session with no lease row', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: 'bare', mainThreadId: 'bare-thread' }),
      )
      const outcome = await harness.plane.append({ threadId: 'bare-thread', epoch: 0, events: [] })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'stale-epoch', current: 0 } })
    })

    it('refuses an expired lease using the injected clock', async () => {
      harness.setNow('2026-11-02T12:02:00.000Z')
      const events = mint({ bodies: [said('x')], epoch })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'lease-expired' } })
      const current = await harness.plane.currentLease({ sessionId: SESSION })
      expect(current.live).toBe(false)
    })

    it('renew extends liveness and rejects the wrong holder', async () => {
      const wrong = await harness.plane.renew({ sessionId: SESSION, holderId: 'nope', epoch })
      expect(wrong).toMatchObject({ ok: false, refusal: { kind: 'stale-epoch' } })
      harness.setNow('2026-11-02T12:00:30.000Z')
      expect((await harness.plane.renew({ sessionId: SESSION, holderId: HOLDER, epoch })).ok).toBe(
        true,
      )
      harness.setNow('2026-11-02T12:01:20.000Z')
      expect((await harness.plane.currentLease({ sessionId: SESSION })).live).toBe(true)
      const revoked = await harness.plane.revoke({ sessionId: SESSION, wantsHolder: false })
      expect(revoked).toMatchObject({ epoch: epoch + 1, holderId: null, wantsHolder: false })
    })

    it('refuses a tampered or skipped event with hash-mismatch', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), said('b')] })
      const head = await harness.plane.head({ threadId: THREAD })
      const [event] = mint({
        bodies: [said('c')],
        epoch,
        from: { ...head, hash: '1'.repeat(64) as typeof head.hash },
      })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events: [event] })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'hash-mismatch', atSeq: 3 } })
      const gap = mint({ bodies: [said('c'), said('d')], epoch, from: head }).slice(1)
      const skipped = await harness.plane.append({ threadId: THREAD, epoch, events: gap })
      expect(skipped).toMatchObject({ ok: false, refusal: { kind: 'seq-mismatch', expected: 3 } })
    })

    it('refuses malformed events', async () => {
      const outcome = await harness.plane.append({
        threadId: THREAD,
        epoch,
        events: [{ type: 'user-said', seq: 1 }],
      })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'malformed', atSeq: 1 } })
    })

    it('take-back boundary: unconsumed deletes, taken-back consume rolls the append back', async () => {
      const gone = await harness.plane.post({ sessionId: SESSION, kind: 'user', payload: '"a"' })
      expect(await harness.plane.takeBack({ sessionId: SESSION, inboxId: gone.inboxId })).toEqual({
        ok: true,
      })
      expect(await harness.plane.takeBack({ sessionId: SESSION, inboxId: gone.inboxId })).toEqual({
        ok: false,
        refusal: { kind: 'unknown-inbox-entry' },
      })
      const keep = await harness.plane.post({ sessionId: SESSION, kind: 'user', payload: '"b"' })
      const head = await harness.plane.head({ threadId: THREAD })
      const events = mint({
        bodies: [said('x'), consumed(keep.inboxId), consumed(gone.inboxId)],
        epoch,
        from: head,
      })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events })
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'unknown-inbox-entry' } })
      expect(await harness.plane.head({ threadId: THREAD })).toEqual(head)
      expect(await readAll({ harness, visible: false })).toEqual([])
      const inbox = await harness.plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })
      expect(inbox.map((entry) => entry.inboxId)).toEqual([keep.inboxId])
    })

    it('round-trips NUL and lone surrogate bodies with identical hashes', async () => {
      const bodies = [said('a\u0000b'), said('x\ud800y'), said('😀')]
      const { events } = await appendBodies({ harness, epoch, bodies })
      const read = await readAll({ harness, visible: false })
      expect(read).toEqual(events)
      const head = await harness.plane.head({ threadId: THREAD })
      expect(head.seq).toBe(3)
    })

    it('visible reads equal core visibleEvents after rewind and summary', async () => {
      const bodies: V2Body[] = Array.from({ length: 8 }, (_, i) => said(`m${i}`))
      bodies.push({ type: 'permission-revoked', grantId: 'g1' })
      bodies.push({
        type: 'history-summarised',
        fromSeq: 2,
        throughSeq: 6,
        anchor: ECompactionAnchor.Prefix,
        summary: 's',
      })
      bodies.push(said('after'))
      bodies.push({ type: 'history-rewound', toSeq: 9 })
      bodies.push(said('tail'))
      const { events } = await appendBodies({ harness, epoch, bodies })
      expect(await readAll({ harness, visible: true })).toEqual(visibleEvents(events))
      expect(await readAll({ harness, visible: true, limit: 2 })).toEqual(visibleEvents(events))
      expect(await readAll({ harness, visible: false })).toEqual(events)
    })

    it('keyset paging returns every event exactly once and caps the limit', async () => {
      await seedTo(120)
      const seen = (await readAll({ harness, visible: false, limit: 7 })).map((e) => e.seq)
      expect(seen).toEqual(Array.from({ length: 120 }, (_, i) => i + 1))
      const page = await harness.plane.readEvents({
        threadId: THREAD,
        afterSeq: 0,
        limit: 5000,
        visible: false,
      })
      expect(page.events.length).toBe(120)
      expect(page.next).toBeUndefined()
    })

    it('concurrent first grants on one session fail only with LeaseConflictError', async () => {
      for (let round = 0; round < 5; round += 1) {
        const sessionId = `race-${round}`
        await harness.plane.createSession(
          createSessionParams({ sessionId, mainThreadId: `race-thread-${round}` }),
        )
        const settled = await Promise.allSettled(
          Array.from({ length: 8 }, (_, i) =>
            harness.plane.grant({ sessionId, holderId: `pod-${i}`, ttlMs: 60_000 }),
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

    it('concurrent appends at the same seq accept exactly one', async () => {
      const head = await harness.plane.head({ threadId: THREAD })
      const attempts = Array.from({ length: 6 }, (_, i) =>
        harness.plane.append({
          threadId: THREAD,
          epoch,
          events: mint({ bodies: [said(`w${i}`)], epoch, from: head }),
        }),
      )
      const outcomes = await Promise.all(attempts)
      expect(outcomes.filter((o) => o.ok).length).toBe(1)
      for (const loser of outcomes.filter((o) => !o.ok)) {
        expect(loser).toMatchObject({ refusal: { kind: 'seq-mismatch', expected: 2 } })
      }
      expect((await readAll({ harness, visible: false })).length).toBe(1)
    })
  })
}
