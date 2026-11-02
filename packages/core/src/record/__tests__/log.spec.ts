import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { GENESIS_HASH, chainHash, verifySuffix, type LogHead } from '../chain'
import { chainEvents } from '../chain-events'
import type { V2Event } from '../event'
import { acceptAppend } from '../log'
import { NOW, lease, mint, runId, threadId, userSaid } from './support'

const genesis: LogHead = { seq: 0, hash: GENESIS_HASH }

const headAfter = (events: V2Event[]): LogHead => {
  const last = events[events.length - 1] as V2Event
  return { seq: last.seq, hash: chainHash(last) }
}

describe('acceptAppend', () => {
  it('accepts a contiguous chained batch and returns each hash', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 20 }), (before, n) => {
        const prefix = before === 0 ? [] : mint({ count: before })
        const head = before === 0 ? genesis : headAfter(prefix)
        const events = mint({ count: n, from: head })
        const result = acceptAppend({ head, lease: lease(), now: NOW, epoch: 3, events })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.hashes).toEqual(events.map(chainHash))
        expect(result.head).toEqual(headAfter(events))
      }),
    )
  })

  it('refuses the second writer at 466 with expected 468 (seq-466 interleaving)', () => {
    const base = mint({ count: 465 })
    const head465 = headAfter(base)
    const first = mint({ count: 2, from: head465 })
    const accepted = acceptAppend({
      head: head465,
      lease: lease(),
      now: NOW,
      epoch: 3,
      events: first,
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(first.map((e) => e.seq)).toEqual([466, 467])
    const second = mint({ count: 1, from: head465 })
    const refused = acceptAppend({
      head: accepted.head,
      lease: lease(),
      now: NOW,
      epoch: 3,
      events: second,
    })
    expect(refused).toEqual({ ok: false, refusal: { kind: 'seq-mismatch', expected: 468 } })
  })

  it('refuses any request or event epoch other than the lease epoch as stale-epoch', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }).filter((e) => e !== 3),
        (epoch) => {
          const events = mint({ count: 2, epoch })
          const stale = acceptAppend({ head: genesis, lease: lease(), now: NOW, epoch, events })
          expect(stale).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 3 } })
          const mixed = acceptAppend({ head: genesis, lease: lease(), now: NOW, epoch: 3, events })
          expect(mixed).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 3 } })
        },
      ),
    )
  })

  it('refuses a lease with no holder as stale-epoch', () => {
    const result = acceptAppend({
      head: genesis,
      lease: lease({ holderId: null }),
      now: NOW,
      epoch: 3,
      events: mint({ count: 1 }),
    })
    expect(result).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 3 } })
  })

  it('refuses an expired lease', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (extra) => {
        const later = new Date(Date.parse(NOW) + 30_000 + extra).toISOString()
        const result = acceptAppend({
          head: genesis,
          lease: lease(),
          now: later,
          epoch: 3,
          events: mint({ count: 1 }),
        })
        expect(result).toEqual({ ok: false, refusal: { kind: 'lease-expired' } })
      }),
    )
  })

  it('checks epoch before liveness, liveness before contiguity, contiguity before chain', () => {
    const expiredNow = '2027-01-01T00:00:00.000Z'
    const stale = mint({ count: 1, epoch: 2 })
    expect(
      acceptAppend({ head: genesis, lease: lease(), now: expiredNow, epoch: 2, events: stale }),
    ).toEqual({ ok: false, refusal: { kind: 'stale-epoch', current: 3 } })
    const gap = mint({ count: 2 }).slice(1)
    expect(
      acceptAppend({ head: genesis, lease: lease(), now: expiredNow, epoch: 3, events: gap }),
    ).toEqual({ ok: false, refusal: { kind: 'lease-expired' } })
    const gapAndBadHash = gap.map(
      (e) => ({ ...e, prevHash: GENESIS_HASH.replace(/0/, '1') }) as V2Event,
    )
    expect(
      acceptAppend({ head: genesis, lease: lease(), now: NOW, epoch: 3, events: gapAndBadHash }),
    ).toEqual({ ok: false, refusal: { kind: 'seq-mismatch', expected: 1 } })
  })

  it('refuses a skipped event as seq-mismatch', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 15 }), fc.nat(), (n, pick) => {
        const events = mint({ count: n })
        const skip = pick % (n - 1)
        const holed = events.filter((_, index) => index !== skip)
        const result = acceptAppend({
          head: genesis,
          lease: lease(),
          now: NOW,
          epoch: 3,
          events: holed,
        })
        expect(result).toEqual({ ok: false, refusal: { kind: 'seq-mismatch', expected: skip + 1 } })
      }),
    )
  })

  it('refuses a tampered predecessor as hash-mismatch at the next seq', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 15 }), fc.nat(), fc.string(), (n, pick, text) => {
        const events = mint({ count: n })
        const at = pick % (n - 1)
        const tampered = events.map((e, index) =>
          index === at ? ({ ...e, type: 'user-said', text: `${text}!` } as V2Event) : e,
        )
        const result = acceptAppend({
          head: genesis,
          lease: lease(),
          now: NOW,
          epoch: 3,
          events: tampered,
        })
        expect(result).toEqual({ ok: false, refusal: { kind: 'hash-mismatch', atSeq: at + 2 } })
      }),
    )
  })

  it('refuses a wrong first prevHash as hash-mismatch', () => {
    const events = mint({
      count: 1,
      from: { seq: 0, hash: chainHash(mint({ count: 1 })[0] as V2Event) },
    })
    const result = acceptAppend({ head: genesis, lease: lease(), now: NOW, epoch: 3, events })
    expect(result).toEqual({ ok: false, refusal: { kind: 'hash-mismatch', atSeq: 1 } })
  })

  it('refuses an empty batch as malformed', () => {
    const result = acceptAppend({ head: genesis, lease: lease(), now: NOW, epoch: 3, events: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal.kind).toBe('malformed')
  })
})

describe('verifySuffix', () => {
  it('verifies any suffix against the trusted head and returns the new head', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), fc.nat(), (n, cut) => {
        const events = mint({ count: n })
        const split = cut % n
        const trusted: LogHead =
          split === 0 ? genesis : { seq: split, hash: chainHash(events[split - 1] as V2Event) }
        const result = verifySuffix({ trusted, events: events.slice(split) })
        expect(result).toEqual({ ok: true, head: headAfter(events) })
      }),
    )
  })

  it('catches a tampered stored row against a trusted head', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.nat(), (n, pick) => {
        const events = mint({ count: n })
        const at = pick % (n - 1)
        const stored = events.map((e, i) =>
          i === at ? ({ ...e, type: 'user-said', text: 'forged' } as V2Event) : e,
        )
        const result = verifySuffix({ trusted: genesis, events: stored })
        expect(result).toEqual({ ok: false, atSeq: at + 2, reason: 'hash-mismatch' })
      }),
    )
  })

  it('reports a gap or a wrong start as seq-mismatch', () => {
    const events = mint({ count: 4 })
    expect(
      verifySuffix({ trusted: genesis, events: [events[0] as V2Event, events[2] as V2Event] }),
    ).toEqual({
      ok: false,
      atSeq: 3,
      reason: 'seq-mismatch',
    })
    expect(verifySuffix({ trusted: genesis, events: events.slice(1) })).toEqual({
      ok: false,
      atSeq: 2,
      reason: 'seq-mismatch',
    })
  })

  it('an empty suffix returns the trusted head', () => {
    expect(verifySuffix({ trusted: genesis, events: [] })).toEqual({ ok: true, head: genesis })
  })
})

describe('chainEvents', () => {
  it('builds events whose bodies and chain link are preserved', () => {
    const events = chainEvents({
      threadId,
      runId,
      epoch: 1,
      at: NOW,
      bodies: [userSaid('a'), userSaid('b')],
    })
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(events[0]?.prevHash).toBe(GENESIS_HASH)
    expect(events[1]?.prevHash).toBe(chainHash(events[0] as V2Event))
  })
})
