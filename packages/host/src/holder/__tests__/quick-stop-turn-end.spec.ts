import {
  ETurnStatus,
  OPERATOR_STOP_REASON,
  PauseSignal,
  type LoopTurnRunner,
  type TurnOutcome,
} from '@dltech/atlas-agent'
import {
  chainEvents,
  ERewindCause,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  toCallId,
  toRunId,
  type Event,
  type RunId,
  type ThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { HeldTurns, type TurnLog } from '../held-turns'
import { closeOpenTurn } from '../orphan-turn'
import type { AppendBody } from '../record/append-drafts'
import type { SessionRecord } from '../record/record-adapter'
import { STOPPED_BY_OPERATOR, ORPHAN_INTERRUPTED } from '../turn-boundary'
import { THREAD, AT, depsOf } from './turn-log-fixture'

const RUN = toRunId('run-1')

class BatchLog implements TurnLog {
  readonly calls: AppendBody[][] = []
  readonly threadId: ThreadId = THREAD

  constructor(private readonly events: readonly RecordEvent[] = []) {}

  eventCache(): {
    eventsAfter(seq: number): RecordEvent[]
    currentHead(): { seq: number }
    queuedSince(): string | null
  } {
    return {
      eventsAfter: () => [...this.events],
      currentHead: () => ({ seq: 1 }),
      queuedSince: () => null,
    }
  }

  async append(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly AppendBody[]
  }): Promise<Event[]> {
    this.calls.push([...args.drafts])
    return []
  }
}

const thinkingOnlyTurn = (): RecordEventBody[] => [
  { type: 'user-said', text: 'think hard about the meaning of life' },
  { type: 'turn-started', turnId: 'turn-quick', cause: ETurnCause.Input },
  { type: 'assistant-said', parts: [{ type: 'reasoning', text: 'weighing it' }] },
]

const drainedAfterStart = (): RecordEventBody[] => [
  { type: 'turn-started', turnId: 'turn-quick', cause: ETurnCause.Input },
  {
    type: 'input-posted',
    inboxId: 5,
    kind: 'message',
    postedAt: '2026-11-24T21:55:00.000Z',
    message: { text: 'think hard about the meaning of life', clientId: 'client-a' },
  },
  { type: 'user-said', text: 'think hard about the meaning of life', inboxId: 5 },
]

const toolTurn = (): RecordEventBody[] => [
  { type: 'user-said', text: 'run the suite' },
  { type: 'turn-started', turnId: 'turn-quick', cause: ETurnCause.Input },
  {
    type: 'tool-called',
    callId: toCallId('c1'),
    name: 'bash',
    input: {},
    ordinal: 0,
  },
]

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId: THREAD, runId: RUN, epoch: 1, at: AT, bodies })

const runnerOf = (outcome: TurnOutcome): LoopTurnRunner =>
  ({
    runTurn: () => Promise.resolve(outcome),
    resume: () => Promise.resolve(outcome),
  }) as unknown as LoopTurnRunner

const stoppedByOperator: TurnOutcome = {
  status: ETurnStatus.Interrupted,
  runId: RUN,
  committed: false,
}

const stoppedTurnOf = async (events: readonly RecordEvent[]): Promise<BatchLog> => {
  const log = new BatchLog(events)
  const turns = new HeldTurns(depsOf())
  const running = turns.drive({
    runner: runnerOf(stoppedByOperator),
    record: log,
    threadId: THREAD,
    pause: new PauseSignal(),
    resume: false,
  })
  turns.abort(OPERATOR_STOP_REASON)
  await running
  return log
}

const lastCallOf = (log: BatchLog): readonly AppendBody[] => log.calls.at(-1) ?? []

describe('a quick stop writes one append', () => {
  it('rewinds the message with the turn it cut', async () => {
    const log = await stoppedTurnOf(eventsOf(thinkingOnlyTurn()))

    const drafts = lastCallOf(log)
    expect(drafts.map((draft) => draft.type)).toEqual(['turn-ended', 'history-rewound'])
    const rewound = drafts[1]
    expect(rewound?.type === 'history-rewound' ? rewound : undefined).toMatchObject({
      toSeq: 0,
      draft: 'think hard about the meaning of life',
      cause: ERewindCause.QuickStop,
    })
  })

  it('rewinds a message the host drained after the turn started', async () => {
    const log = await stoppedTurnOf(eventsOf(drainedAfterStart()))

    const drafts = lastCallOf(log)
    expect(drafts.map((draft) => draft.type)).toEqual(['turn-ended', 'history-rewound'])
    const rewound = drafts[1]
    expect(rewound?.type === 'history-rewound' ? rewound : undefined).toMatchObject({
      toSeq: 0,
      draft: 'think hard about the meaning of life',
      cause: ERewindCause.QuickStop,
    })
  })

  it('keeps the message when a tool ran', async () => {
    const log = await stoppedTurnOf(eventsOf(toolTurn()))

    expect(lastCallOf(log).map((draft) => draft.type)).toEqual(['turn-ended'])
  })
})

describe('closing an open turn as stopped by the operator', () => {
  const recordOf = (log: BatchLog): SessionRecord => log as unknown as SessionRecord

  it('rewinds a thinking-only turn in the same append', async () => {
    const log = new BatchLog(eventsOf(thinkingOnlyTurn()))

    await closeOpenTurn({ deps: depsOf(), record: recordOf(log), ending: STOPPED_BY_OPERATOR })

    expect(log.calls.length).toBe(1)
    expect(log.calls[0]?.map((draft) => draft.type)).toEqual(['turn-ended', 'history-rewound'])
    expect(log.calls[0]?.[0]).toEqual({
      type: 'turn-ended',
      turnId: 'turn-quick',
      outcome: ETurnOutcome.Stopped,
      by: ETurnEndedBy.Operator,
    })
  })

  it('writes only the turn end when the host interrupts the turn', async () => {
    const log = new BatchLog(eventsOf(thinkingOnlyTurn()))

    await closeOpenTurn({ deps: depsOf(), record: recordOf(log), ending: ORPHAN_INTERRUPTED })

    expect(log.calls[0]?.map((draft) => draft.type)).toEqual(['turn-ended'])
  })
})
