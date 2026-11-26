import { describe, expect, test } from 'bun:test'

import {
  chainEvents,
  chainHash,
  ECompactionAnchor,
  ERunFailureKind,
  ETurnCause,
  GENESIS_HASH,
  initialSessionViewState,
  isCommandLogEvent,
  isRetained,
  retainedOf,
  isSurviving,
  isVisible,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { foldEvents } from '../src/session-view-ops'
import { InMemoryControlStore } from '../src/testing/memory'

const AT = '2026-11-24T10:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'
const OWNER = 'user-a'
const TAIL_FROM = 41

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

const bodiesOf = (): RecordEventBody[] => [
  { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
  ...Array.from({ length: 29 }, (_, n) => said(`m${n}`)),
  { type: 'history-rewound', toSeq: 20 },
  {
    type: 'history-summarised',
    fromSeq: 1,
    throughSeq: 10,
    anchor: ECompactionAnchor.Prefix,
    summary: 'short',
  },
  ...Array.from({ length: 28 }, (_, n) => said(`n${n}`)),
]

const worldOf = async (
  bodies: RecordEventBody[] = bodiesOf(),
): Promise<{ plane: ControlPlane; events: RecordEvent[] }> => {
  const store = new InMemoryControlStore({ clock: () => AT })
  const plane = new ControlPlane({ store, clock: () => AT })
  await plane.createSession({
    sessionId: SESSION,
    userId: OWNER,
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const events: RecordEvent[] = []
  let head: LogHead = { seq: 0, hash: GENESIS_HASH }
  for (let start = 0; start < bodies.length; start += 10) {
    const chained = chainEvents({
      threadId: toThreadId(THREAD),
      runId: toRunId('run-1'),
      epoch: lease.epoch,
      at: AT,
      bodies: bodies.slice(start, start + 10),
      from: head,
    })
    const outcome = await plane.append({ threadId: THREAD, epoch: lease.epoch, events: chained })
    if (!outcome.ok) throw new Error('append refused')
    head = outcome.head
    events.push(...chained)
  }
  return { plane, events }
}

const seqsBefore = (args: {
  events: readonly RecordEvent[]
  matches: (event: RecordEvent) => boolean
}): number[] =>
  args.events
    .filter((event) => event.seq < TAIL_FROM && args.matches(event))
    .map((event) => event.seq)

describe('readTailBase', () => {
  test('reads the cursor, the view at head, the visibility and the prefix lists', async () => {
    const { plane, events } = await worldOf()
    const head = await plane.head({ threadId: THREAD })
    expect(head.seq).toBe(60)

    const base = await plane.readTailBase({
      sessionId: SESSION,
      threadId: THREAD,
      tailFrom: TAIL_FROM,
    })

    expect(base?.cursor).toEqual({ seq: 40, hash: chainHash(events[39] as RecordEvent) })
    const folded = foldEvents({ state: initialSessionViewState, events }).state
    expect(base?.view.at).toBe(60)
    expect(base?.view.version).toBe(folded.version)
    expect(base?.view.facts).toEqual(folded.facts)
    expect(base?.view.pending).toEqual(folded.pending)
    expect(base?.view.spend).toEqual(folded.spend)
    expect(base?.view.checkouts).toEqual(folded.checkouts)
    expect(base?.view.failure).toEqual(folded.failure)
    expect(base?.durable.map((event) => event.seq)).toEqual(
      retainedOf({
        events: events.filter((event) => isRetained(event.type) && event.seq < 41),
        before: 41,
      }).map((event) => event.seq),
    )
    expect(base?.durable.map((event) => event.seq)).toEqual([1, 31])
    expect(base?.commandLog.map((event) => event.seq)).toEqual(
      seqsBefore({ events, matches: isCommandLogEvent }),
    )
    expect(base?.commandLog.map((event) => event.seq)).toEqual([31, 32])
    const visibility = base?.visibility ?? { spans: [] }
    expect(isVisible(visibility, events[4] as RecordEvent)).toBe(false)
    expect(isSurviving(visibility, events[24] as RecordEvent)).toBe(false)
    expect(isVisible(visibility, events[50] as RecordEvent)).toBe(true)
  })

  test('drops a run failure a later message superseded before the tail', async () => {
    const runFailed: RecordEventBody = {
      type: 'run-failed',
      failure: { kind: ERunFailureKind.Auth, message: 'signed out' },
    }
    const { plane } = await worldOf([
      { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
      runFailed,
      ...Array.from({ length: 36 }, (_, n) => said(`m${n}`)),
      runFailed,
      { type: 'input-refused', inboxId: 1, reason: 'no' },
      ...Array.from({ length: 20 }, (_, n) => said(`n${n}`)),
    ])

    const base = await plane.readTailBase({
      sessionId: SESSION,
      threadId: THREAD,
      tailFrom: TAIL_FROM,
    })

    expect(base?.durable.map((event) => event.seq)).toEqual([1, 39, 40])
  })

  test('refuses a base at the start of the log', async () => {
    const { plane } = await worldOf()
    expect(
      await plane.readTailBase({ sessionId: SESSION, threadId: THREAD, tailFrom: 1 }),
    ).toBeUndefined()
  })
})
