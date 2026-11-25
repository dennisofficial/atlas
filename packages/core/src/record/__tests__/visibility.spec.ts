import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { ECompactionAnchor } from '../../events/body'
import { KEPT_THROUGH_COMPACTION } from '../../compaction/disposition'
import { chainHash } from '../chain'
import { chainEvents } from '../chain-events'
import type { RecordEventBody, RecordEvent } from '../event'
import {
  EMPTY_VISIBILITY,
  isSurviving,
  isVisible,
  stepVisibility,
  visibleEvents,
  visibleSegments,
} from '../visibility'
import { openTurnOf, ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'
import { NOW, runId, threadId } from './support'

type Op =
  | { kind: 'message' }
  | { kind: 'survivor' }
  | { kind: 'rewind'; pick: number }
  | { kind: 'summarise'; a: number; b: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Op>({ kind: 'message' }) },
  { weight: 2, arbitrary: fc.constant<Op>({ kind: 'survivor' }) },
  { weight: 2, arbitrary: fc.nat(1000).map((pick): Op => ({ kind: 'rewind', pick })) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.nat(1000), fc.nat(1000))
      .map(([a, b]): Op => ({ kind: 'summarise', a, b })),
  },
)

const bodyFor = (params: { op: Op; nextSeq: number; targets: number[] }): RecordEventBody => {
  const { op, nextSeq, targets } = params
  if (op.kind === 'message' || nextSeq < 3) return { type: 'user-said', text: `m${nextSeq}` }
  if (op.kind === 'survivor') return { type: 'permission-revoked', grantId: `g${nextSeq}` }
  if (op.kind === 'rewind') {
    return { type: 'history-rewound', toSeq: targets[op.pick % targets.length] as number }
  }
  const first = (op.a % (nextSeq - 1)) + 1
  const second = (op.b % (nextSeq - 1)) + 1
  return {
    type: 'history-summarised',
    fromSeq: Math.min(first, second),
    throughSeq: Math.max(first, second),
    anchor: ECompactionAnchor.Prefix,
    summary: `s${nextSeq}`,
  }
}

const buildLog = (ops: Op[]): RecordEvent[] => {
  const log: RecordEvent[] = []
  let state = EMPTY_VISIBILITY
  ops.forEach((op, index) => {
    const nextSeq = index + 1
    const targets = [0, ...log.filter((event) => isVisible(state, event)).map((event) => event.seq)]
    const [event] = chainEvents({
      threadId,
      runId,
      epoch: 1,
      at: NOW,
      from:
        log.length === 0
          ? undefined
          : { seq: nextSeq - 1, hash: chainHash(log[log.length - 1] as RecordEvent) },
      bodies: [bodyFor({ op, nextSeq, targets })],
    })
    log.push(event as RecordEvent)
    state = stepVisibility(state, event as RecordEvent)
  })
  return log
}

const logArb = fc.array(opArb, { minLength: 1, maxLength: 60 }).map(buildLog)

const survivor = (type: string): boolean =>
  (KEPT_THROUGH_COMPACTION as readonly string[]).includes(type)

const referenceVisible = (log: readonly RecordEvent[]): RecordEvent[] => {
  const snapshots = new Map<number, RecordEvent[]>([[0, []]])
  let current: RecordEvent[] = []
  for (const event of log) {
    if (event.type === 'history-rewound') {
      current = [...(snapshots.get(event.toSeq) ?? [])]
    } else if (event.type === 'history-summarised') {
      current = current.filter(
        (shown) =>
          shown.seq < event.fromSeq || shown.seq > event.throughSeq || survivor(shown.type),
      )
      current.push(event)
    } else {
      current = [...current, event]
    }
    snapshots.set(event.seq, current)
  }
  return current
}

const readThroughSegments = (params: {
  log: readonly RecordEvent[]
  state: ReturnType<typeof stepVisibility>
  fromSeq: number
  throughSeq: number
}): RecordEvent[] =>
  visibleSegments(params).flatMap((segment) =>
    params.log.filter(
      (event) =>
        event.seq >= segment.fromSeq &&
        event.seq <= segment.throughSeq &&
        (segment.onlyTypes === undefined || segment.onlyTypes.includes(event.type)),
    ),
  )

describe('visibility', () => {
  it('visibleEvents equals the reference truncation model', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        expect(visibleEvents(log).map((e) => e.seq)).toEqual(
          referenceVisible(log).map((e) => e.seq),
        )
      }),
      { numRuns: 300 },
    )
  })

  it('rewind hides the tail and the marker, and later events show', () => {
    const log = chainEvents({
      threadId,
      runId,
      epoch: 1,
      at: NOW,
      bodies: [
        { type: 'user-said', text: 'a' },
        { type: 'user-said', text: 'b' },
        { type: 'history-rewound', toSeq: 1 },
        { type: 'user-said', text: 'c' },
      ],
    })
    expect(visibleEvents(log).map((e) => e.seq)).toEqual([1, 4])
  })

  it('a rewind below a summary restores the summarised events', () => {
    const log = chainEvents({
      threadId,
      runId,
      epoch: 1,
      at: NOW,
      bodies: [
        { type: 'user-said', text: 'a' },
        { type: 'user-said', text: 'b' },
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 2,
          anchor: ECompactionAnchor.Prefix,
          summary: 's',
        },
        { type: 'history-rewound', toSeq: 2 },
      ],
    })
    expect(visibleEvents(log).map((e) => e.seq)).toEqual([1, 2])
  })

  it('segment-driven reads equal visibleEvents over every range', () => {
    fc.assert(
      fc.property(logArb, fc.nat(100), fc.nat(100), (log, x, y) => {
        const state = log.reduce(stepVisibility, EMPTY_VISIBILITY)
        const last = log.length
        const fromSeq = (x % last) + 1
        const throughSeq = fromSeq + (y % (last - fromSeq + 1))
        const expected = visibleEvents(log).filter((e) => e.seq >= fromSeq && e.seq <= throughSeq)
        expect(readThroughSegments({ log, state, fromSeq, throughSeq })).toEqual(expected)
      }),
      { numRuns: 300 },
    )
  })

  it('isVisible agrees with visibleEvents', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const state = log.reduce(stepVisibility, EMPTY_VISIBILITY)
        expect(log.filter((e) => isVisible(state, e))).toEqual(visibleEvents(log))
      }),
    )
  })

  it('state grows with live edits, never with log length', () => {
    fc.assert(
      fc.property(logArb, fc.integer({ min: 0, max: 200 }), (log, extra) => {
        const edits = log.filter(
          (e) => e.type === 'history-rewound' || e.type === 'history-summarised',
        )
        const state = log.reduce(stepVisibility, EMPTY_VISIBILITY)
        expect(state.spans.length).toBeLessThanOrEqual(edits.length)
        const plain = chainEvents({
          threadId,
          runId,
          epoch: 1,
          at: NOW,
          from: { seq: log.length, hash: chainHash(log[log.length - 1] as RecordEvent) },
          bodies: Array.from(
            { length: extra },
            () => ({ type: 'user-said', text: 'x' }) as RecordEventBody,
          ),
        })
        const after = plain.reduce(stepVisibility, state)
        expect(after.spans.length).toBe(state.spans.length)
      }),
    )
  })

  it('rewinds drop spans created after the target', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (n) => {
        const bodies: RecordEventBody[] = []
        for (let i = 1; i <= n; i += 1) bodies.push({ type: 'user-said', text: `m${i}` })
        for (let i = 0; i < 5; i += 1) bodies.push({ type: 'history-rewound', toSeq: n })
        const spans = (all: RecordEventBody[]) =>
          chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies: all }).reduce(
            stepVisibility,
            EMPTY_VISIBILITY,
          ).spans
        expect(spans(bodies).length).toBe(1)
        expect(spans([...bodies, { type: 'history-rewound', toSeq: 0 }]).length).toBe(1)
      }),
    )
  })
})

describe('a rewind that lands inside a turn', () => {
  const build = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
    chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

  const insideATurn = build([
    { type: 'user-said', text: 'a' },
    { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
    { type: 'user-said', text: 'the message rewound to' },
    {
      type: 'turn-ended',
      turnId: 'turn-1',
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
    },
    { type: 'history-rewound', toSeq: 2 },
    { type: 'user-said', text: 'c' },
  ])

  it('keeps the end of the turn it leaves the start of', () => {
    expect(visibleEvents(insideATurn).map((event) => event.seq)).toEqual([1, 2, 4, 6])
    expect(openTurnOf(visibleEvents(insideATurn))).toBeNull()
  })

  it('reads the same rows through the visible segments', () => {
    const state = insideATurn.reduce(stepVisibility, EMPTY_VISIBILITY)
    expect(
      readThroughSegments({ log: insideATurn, state, fromSeq: 1, throughSeq: insideATurn.length }),
    ).toEqual(visibleEvents(insideATurn))
  })

  it('hides both boundaries of a turn it swallows whole', () => {
    const swallowed = build([
      { type: 'user-said', text: 'a' },
      { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'half' }], stopped: true },
      {
        type: 'turn-ended',
        turnId: 'turn-1',
        outcome: ETurnOutcome.Stopped,
        by: ETurnEndedBy.Operator,
      },
      { type: 'history-rewound', toSeq: 1 },
    ])
    expect(visibleEvents(swallowed).map((event) => event.seq)).toEqual([1])
  })
})

describe('the surviving log', () => {
  const build = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
    chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

  it('keeps an event a summary hid and drops one a rewind hid', () => {
    const summarised = build([
      { type: 'user-said', text: 'a' },
      { type: 'user-said', text: 'b' },
      {
        type: 'history-summarised',
        fromSeq: 1,
        throughSeq: 2,
        anchor: ECompactionAnchor.Prefix,
        summary: 's',
      },
    ])
    const summaryState = summarised.reduce(stepVisibility, EMPTY_VISIBILITY)
    expect(isVisible(summaryState, summarised[1] as RecordEvent)).toBe(false)
    expect(isSurviving(summaryState, summarised[1] as RecordEvent)).toBe(true)

    const rewound = build([
      { type: 'user-said', text: 'a' },
      { type: 'user-said', text: 'b' },
      { type: 'user-said', text: 'c' },
      { type: 'history-rewound', toSeq: 2 },
    ])
    const rewindState = rewound.reduce(stepVisibility, EMPTY_VISIBILITY)
    expect(isSurviving(rewindState, rewound[0] as RecordEvent)).toBe(true)
    expect(isSurviving(rewindState, rewound[2] as RecordEvent)).toBe(false)
    expect(isSurviving(rewindState, rewound[3] as RecordEvent)).toBe(false)
  })
})
