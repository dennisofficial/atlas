import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { consume, takeBack, type InboxEntry } from '../inbox'
import { grant, isLive, renew, revoke } from '../lease'
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
  it('grant bumps the epoch and installs the holder', () => {
    fc.assert(
      fc.property(
        fc.nat(1000),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 1e6 }),
        (epoch, holderId, ttlMs) => {
          const next = grant({ lease: lease({ epoch }), holderId, ttlMs, now: NOW })
          expect(next).toMatchObject({ epoch: epoch + 1, holderId, ttlMs, renewedAt: NOW })
          expect(isLive({ lease: next, now: NOW })).toBe(true)
        },
      ),
    )
  })

  it('revoke bumps the epoch and clears the holder, never live', () => {
    const next = revoke({ lease: lease(), now: NOW })
    expect(next.epoch).toBe(4)
    expect(next.holderId).toBeNull()
    expect(isLive({ lease: next, now: NOW })).toBe(false)
  })

  it('isLive flips exactly at renewedAt + ttlMs', () => {
    const l = lease({ ttlMs: 1000 })
    const at = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString()
    expect(isLive({ lease: l, now: at(999) })).toBe(true)
    expect(isLive({ lease: l, now: at(1000) })).toBe(false)
  })

  it('renew extends a live lease for the holder at the current epoch', () => {
    const later = new Date(Date.parse(NOW) + 10_000).toISOString()
    expect(renew({ lease: lease(), holderId: 'pod-a', epoch: 3, now: later })).toEqual({
      ok: true,
      lease: lease({ renewedAt: later }),
    })
  })

  it('renew refuses a wrong epoch or holder as stale-epoch', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }).filter((e) => e !== 3),
        (epoch) => {
          expect(renew({ lease: lease(), holderId: 'pod-a', epoch, now: NOW })).toEqual({
            ok: false,
            refusal: { kind: 'stale-epoch', current: 3 },
          })
        },
      ),
    )
    expect(renew({ lease: lease(), holderId: 'pod-b', epoch: 3, now: NOW })).toEqual({
      ok: false,
      refusal: { kind: 'stale-epoch', current: 3 },
    })
  })

  it('renew refuses an expired lease', () => {
    const later = new Date(Date.parse(NOW) + 30_000).toISOString()
    expect(renew({ lease: lease(), holderId: 'pod-a', epoch: 3, now: later })).toEqual({
      ok: false,
      refusal: { kind: 'lease-expired' },
    })
  })
})
