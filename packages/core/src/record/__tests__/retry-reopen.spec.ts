import { describe, expect, it } from 'bun:test'

import { ERunFailureKind } from '../../events/run-failure'
import { chainEvents } from '../chain-events'
import { EInputConsumed } from '../event'
import type { RecordEventBody, RecordEvent } from '../event'
import { RETRY_NUDGE, retryReopenDraftsOf } from '../retry-reopen'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'
import { NOW, runId, threadId } from './support'

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

const replied = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const runFailed: RecordEventBody = {
  type: 'run-failed',
  failure: { kind: ERunFailureKind.FinishFault, message: 'the safety filter ended the reply' },
}

const turnStarted: RecordEventBody = {
  type: 'turn-started',
  turnId: 'turn-2',
  cause: ETurnCause.Input,
}

const inputConsumed: RecordEventBody = {
  type: 'input-consumed',
  inboxId: 4,
  consumed: EInputConsumed.Discarded,
}

const turnEnded: RecordEventBody = {
  type: 'turn-ended',
  turnId: 'turn-2',
  outcome: ETurnOutcome.Completed,
  by: ETurnEndedBy.Agent,
}

const draftOf = (bodies: readonly RecordEventBody[]) =>
  retryReopenDraftsOf({ events: eventsOf(bodies) })

describe('retryReopenDraftsOf', () => {
  it('reopens a reply the content filter cut short after it was recorded', () => {
    expect(draftOf([said('do the work'), replied('partial'), runFailed])).toEqual([
      { type: 'nudge', text: RETRY_NUDGE, lifetimeSteps: 1 },
    ])
  })

  it('leaves a failure with no reply to the ordinary resume', () => {
    expect(draftOf([said('do the work'), runFailed])).toEqual([])
  })

  it('does nothing when a later message already superseded the failure', () => {
    expect(
      draftOf([said('do the work'), replied('partial'), runFailed, said('try again')]),
    ).toEqual([])
  })

  it('does nothing when a nudge already reopened the failure', () => {
    expect(
      draftOf([
        said('do the work'),
        replied('partial'),
        runFailed,
        { type: 'nudge', text: RETRY_NUDGE, lifetimeSteps: 1 },
      ]),
    ).toEqual([])
  })

  it('does nothing when no run failed', () => {
    expect(draftOf([said('do the work'), replied('partial')])).toEqual([])
  })

  it('reopens a failure whose earlier retry turn took no model step', () => {
    expect(
      draftOf([
        said('do the work'),
        replied('partial'),
        runFailed,
        turnStarted,
        inputConsumed,
        turnEnded,
      ]),
    ).toEqual([{ type: 'nudge', text: RETRY_NUDGE, lifetimeSteps: 1 }])
  })
})
