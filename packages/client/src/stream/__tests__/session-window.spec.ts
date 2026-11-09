import { describe, expect, it } from 'bun:test'
import type { V2Body, V2Event } from '@dltech/atlas-core'
import fc from 'fast-check'

import {
  applyPage,
  applyPageOutcome,
  EMPTY_WINDOW,
  resetWindow,
  WINDOW_LIMIT,
  type SessionWindow,
} from '../session-window'
import { headOf, mintEvents, mintUserEvents } from './support'

const page = (events: readonly V2Event[], head = headOf(events)) => ({
  events: events.map((event) => ({ ...event })) as unknown[],
  head,
})

const seqsOf = (window: SessionWindow): number[] => window.events.map((event) => event.seq)

describe('applyPage', () => {
  it('appends a page and moves the cursor to the page head', () => {
    const events = mintUserEvents({ count: 3 })
    const window = applyPage({ window: EMPTY_WINDOW, page: page(events) })
    expect(seqsOf(window)).toEqual([1, 2, 3])
    expect(window.cursor).toEqual(headOf(events))
  })

  it('uses the last event hash when the page stops short of the head', () => {
    const events = mintUserEvents({ count: 4 })
    const shortPage = page(events.slice(0, 2), headOf(events))
    const window = applyPage({ window: EMPTY_WINDOW, page: shortPage })
    expect(window.cursor).toEqual(headOf(events.slice(0, 2)))
  })

  it('drops events at or below the cursor', () => {
    const events = mintUserEvents({ count: 4 })
    const first = applyPage({ window: EMPTY_WINDOW, page: page(events.slice(0, 3)) })
    const second = applyPage({ window: first, page: page(events.slice(1)) })
    expect(seqsOf(second)).toEqual([1, 2, 3, 4])
    expect(second.cursor).toEqual(headOf(events))
  })

  it('skips an event it cannot parse and reads the ones after it', () => {
    const events = mintUserEvents({ count: 3 })
    const raw = [{ ...events[0] }, { seq: 2, type: 'from-the-future' }, { ...events[2] }]
    const outcome = applyPageOutcome({
      window: EMPTY_WINDOW,
      page: { events: raw, head: headOf(events) },
    })
    expect(seqsOf(outcome.window)).toEqual([1, 3])
    expect(outcome.window.cursor).toEqual(headOf(events))
    expect(outcome.skipped).toBe(1)
    expect(outcome.issue).toBeString()
  })

  it('moves the cursor past a skipped event so the next page starts after it', () => {
    const events = mintUserEvents({ count: 3 })
    const first = applyPageOutcome({
      window: EMPTY_WINDOW,
      page: {
        events: [{ ...events[0] }, { seq: 2, type: 'from-the-future' }],
        head: headOf(events),
      },
    })
    expect(first.window.cursor?.seq).toBe(2)
    const second = applyPage({ window: first.window, page: page(events) })
    expect(seqsOf(second)).toEqual([1, 3])
  })

  it('reports nothing skipped for a clean page', () => {
    const outcome = applyPageOutcome({
      window: EMPTY_WINDOW,
      page: page(mintUserEvents({ count: 2 })),
    })
    expect(outcome.skipped).toBe(0)
    expect(outcome.issue).toBeUndefined()
  })

  it('keeps the cursor on an empty page', () => {
    const events = mintUserEvents({ count: 2 })
    const first = applyPage({ window: EMPTY_WINDOW, page: page(events) })
    const second = applyPage({ window: first, page: { events: [], head: headOf(events) } })
    expect(second).toEqual(first)
  })

  it('hides the cached range a rewind covers', () => {
    const before = mintUserEvents({ count: 4 })
    const cached = applyPage({ window: EMPTY_WINDOW, page: page(before) })
    const rewind = mintEvents({
      bodies: [{ type: 'history-rewound', toSeq: 2 }],
      from: headOf(before),
    })
    const after = applyPage({ window: cached, page: page(rewind) })
    expect(seqsOf(after)).toEqual([1, 2])
    expect(after.cursor?.seq).toBe(5)
  })

  it('keeps only the last 3,000 visible events', () => {
    const events = mintUserEvents({ count: WINDOW_LIMIT + 50 })
    const window = applyPage({ window: EMPTY_WINDOW, page: page(events) })
    expect(window.events).toHaveLength(WINDOW_LIMIT)
    expect(window.events[0]?.seq).toBe(51)
    expect(window.cursor?.seq).toBe(WINDOW_LIMIT + 50)
  })

  it('resets to an empty window with no cursor', () => {
    const window = applyPage({ window: EMPTY_WINDOW, page: page(mintUserEvents({ count: 2 })) })
    expect(window.cursor).toBeDefined()
    expect(resetWindow()).toEqual(EMPTY_WINDOW)
  })
})

type Op = { kind: 'message' } | { kind: 'rewind'; pick: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Op>({ kind: 'message' }) },
  { weight: 1, arbitrary: fc.nat(1000).map((pick): Op => ({ kind: 'rewind', pick })) },
)

const logOf = (ops: readonly Op[]): V2Event[] => {
  const bodies: V2Body[] = []
  const visibleSeqs: number[] = []
  for (const op of ops) {
    const seq = bodies.length + 1
    if (op.kind === 'rewind' && visibleSeqs.length > 0) {
      const toSeq = visibleSeqs[op.pick % visibleSeqs.length] as number
      bodies.push({ type: 'history-rewound', toSeq })
      visibleSeqs.splice(visibleSeqs.indexOf(toSeq) + 1)
      continue
    }
    bodies.push({ type: 'user-said', text: `m${seq}` })
    visibleSeqs.push(seq)
  }
  return mintEvents({ bodies })
}

describe('cache plus stream', () => {
  it('equals a fresh tail for any split point across rewinds', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 1, maxLength: 40 }),
        fc.nat(100),
        (ops, splitPick) => {
          const log = logOf(ops)
          const split = splitPick % (log.length + 1)
          const fresh = applyPage({ window: EMPTY_WINDOW, page: page(log) })
          const head = log.slice(0, split)
          let cached: SessionWindow = EMPTY_WINDOW
          if (head.length > 0) cached = applyPage({ window: cached, page: page(head) })
          const revived = JSON.parse(JSON.stringify(cached)) as SessionWindow
          const rest = log.slice(split)
          const resumed =
            rest.length === 0 ? revived : applyPage({ window: revived, page: page(rest) })
          expect(resumed.events).toEqual(fresh.events)
          expect(resumed.cursor).toEqual(fresh.cursor)
        },
      ),
    )
  })
})
