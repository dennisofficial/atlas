import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  decideHeldAction,
  EHeldAction,
  EInputConsumed,
  EResumePoint,
  RESUME_REFUSAL_MESSAGE,
  resumePointOf,
  EWorkspaceState,
  isResumablePlan,
  loopStateOf,
  resumePlanOf,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  toRunId,
  toThreadId,
  visibleLoopEvents,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import { stopSettledPromptOf } from '../held-inbox'

const threadId = toThreadId('thread-1')
const runId = toRunId('run-1')
const at = '2026-01-01T00:00:00.000Z'

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId, epoch: 1, at, bodies })

const stopped: readonly RecordEventBody[] = [
  { type: 'user-said', text: 'run the suite' },
  { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
  {
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'half a sentence' }],
    interrupted: true,
    stopped: true,
  },
  { type: 'input-consumed', inboxId: 3, consumed: EInputConsumed.Stop },
  {
    type: 'turn-ended',
    turnId: 'turn-1',
    outcome: ETurnOutcome.Stopped,
    by: ETurnEndedBy.Operator,
  },
]

const marker: RecordEventBody = {
  type: 'resume-marked',
  point: EResumePoint.Clean,
  discards: [{ fromSeq: 3, throughSeq: 3 }],
  callIds: [],
  inboxId: 4,
}

const resumableOf = (events: readonly RecordEvent[]): boolean =>
  !stopSettledPromptOf(events) &&
  isResumablePlan(resumePlanOf(loopStateOf({ events: visibleLoopEvents(events) })))

const decidedOf = (events: readonly RecordEvent[]): EHeldAction =>
  decideHeldAction({
    draining: false,
    turn: 'idle',
    stopPending: false,
    messagePending: false,
    commandPending: false,
    resumable: resumableOf(events),
    idleDue: true,
    workspace: EWorkspaceState.Prepared,
    preparedBefore: true,
    retryPending: false,
    parked: false,
  })

describe('the resume marker as the prompt', () => {
  it('keeps the stop settled while it is the last prompt', () => {
    const events = eventsOf(stopped)

    expect(stopSettledPromptOf(events)).toBe(true)
    expect(resumableOf(events)).toBe(false)
    expect(decidedOf(events)).toBe(EHeldAction.Release)
  })

  it('reopens the thread once the marker follows the stop', () => {
    const events = eventsOf([...stopped, marker])

    expect(stopSettledPromptOf(events)).toBe(false)
    expect(resumableOf(events)).toBe(true)
    expect(decidedOf(events)).toBe(EHeldAction.StartTurn)
  })

  it('refuses the resume once a message follows the stop', () => {
    const events = eventsOf([...stopped, { type: 'user-said', text: 'never mind' }])

    expect(resumePointOf({ events })).toEqual({
      kind: EResumePoint.NotResumable,
      because: RESUME_REFUSAL_MESSAGE,
    })
  })
})
