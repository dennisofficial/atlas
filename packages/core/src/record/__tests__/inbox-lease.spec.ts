import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { consume, takeBack, type InboxEntry } from '../inbox'
import { claim, claimGrant, grant, retryDelayMs, revoke, revokeIfEpoch } from '../lease'
import { NOW, lease } from './support'

const entry = (consumedSeq: number | null): InboxEntry => ({
  sessionId: 's',
  inboxId: 1,
  kind: 'user-said',
  payload: '{}',
  postedAt: NOW,
  consumedSeq,
})

describe('inbox moves', () => {
  it('take-back deletes an unconsumed entry', () => {
    expect(takeBack(entry(null))).toEqual({ ok: true, action: 'delete' })
  })

  it('take-back of a consumed entry is already-consumed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1 }), (seq) => {
        expect(takeBack(entry(seq))).toEqual({ ok: false, refusal: { kind: 'already-consumed' } })
      }),
    )
  })

  it('consume stamps the seq on an unconsumed entry', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1 }), (seq) => {
        expect(consume({ entry: entry(null), seq })).toEqual({ ok: true, entry: entry(seq) })
      }),
    )
  })

  it('consume of an absent entry is unknown-inbox-entry', () => {
    expect(consume({ entry: undefined, seq: 5 })).toEqual({
      ok: false,
      refusal: { kind: 'unknown-inbox-entry' },
    })
  })

  it('consume of a consumed entry is already-consumed', () => {
    expect(consume({ entry: entry(4), seq: 5 })).toEqual({
      ok: false,
      refusal: { kind: 'already-consumed' },
    })
  })
})

describe('lease moves', () => {
  it('grant bumps the epoch, installs the host and clears wantsHolder', () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(1000), fc.boolean(), (epoch, hostId, wantsHolder) => {
        const next = grant({ lease: lease({ epoch, wantsHolder }), hostId })
        expect(next).toMatchObject({
          epoch: epoch + 1,
          holderHostId: hostId,
          wantsHolder: false,
        })
      }),
    )
  })

  it('revoke bumps the epoch, clears the holder and records wantsHolder', () => {
    const drained = revoke({ lease: lease(), wantsHolder: true })
    expect(drained.epoch).toBe(4)
    expect(drained.holderHostId).toBeNull()
    expect(drained.wantsHolder).toBe(true)
    const released = revoke({ lease: lease({ wantsHolder: true }), wantsHolder: false })
    expect(released.wantsHolder).toBe(false)
  })

  it('revokeIfEpoch refuses a wrong epoch as stale-epoch', () => {
    expect(revokeIfEpoch({ lease: lease(), wantsHolder: false, epoch: 2 })).toEqual({
      ok: false,
      refusal: { kind: 'stale-epoch', current: 3 },
    })
    expect(revokeIfEpoch({ lease: lease(), wantsHolder: false, epoch: 3 })).toMatchObject({
      ok: true,
      lease: { epoch: 4, holderHostId: null },
    })
  })

  it('claim refuses while the holder host is present', () => {
    expect(claim({ lease: lease(), hostId: 9, holderPresent: true, selfPresent: true })).toEqual({
      ok: false,
      refusal: { kind: 'held', epoch: 3 },
    })
  })

  it('claim takes over once the holder host is absent', () => {
    expect(claim({ lease: lease(), hostId: 9, holderPresent: false, selfPresent: true })).toEqual({
      ok: true,
      lease: lease({ epoch: 4, holderHostId: 9 }),
    })
  })

  it('claim grants an unheld lease whatever holderPresent says', () => {
    const unheld = lease({ holderHostId: null })
    expect(
      claim({ lease: unheld, hostId: 9, holderPresent: true, selfPresent: true }),
    ).toMatchObject({ ok: true, lease: { epoch: 4, holderHostId: 9 } })
  })

  it('claim refuses a claimer that is not present', () => {
    expect(claim({ lease: lease(), hostId: 9, holderPresent: false, selfPresent: false })).toEqual({
      ok: false,
      refusal: { kind: 'not-present' },
    })
    expect(
      claim({
        lease: lease({ holderHostId: null }),
        hostId: 9,
        holderPresent: false,
        selfPresent: false,
      }),
    ).toEqual({ ok: false, refusal: { kind: 'not-present' } })
  })
})

describe('claimGrant', () => {
  it('bumps the epoch, installs the host, counts the claim and schedules the retry', () => {
    const now = '2026-11-06T12:00:00.000Z'
    const next = claimGrant({
      lease: lease({ holderHostId: null, wantsHolder: true, attempts: 2 }),
      hostId: 9,
      now,
    })
    expect(next).toEqual(
      lease({
        epoch: 4,
        holderHostId: 9,
        wantsHolder: false,
        attempts: 3,
        retryAfter: '2026-11-06T12:00:04.000Z',
      }),
    )
  })

  it('grant leaves the retry columns as they are', () => {
    const retryAfter = '2026-11-06T12:00:04.000Z'
    expect(grant({ lease: lease({ attempts: 2, retryAfter }), hostId: 9 })).toMatchObject({
      attempts: 2,
      retryAfter,
    })
  })
})

describe('retryDelayMs', () => {
  it('doubles from one second and caps at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((attempts) => retryDelayMs(attempts))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ])
  })
})
