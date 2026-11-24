import { describe, expect, it } from 'bun:test'

import { toCallId, toRunId, toThreadId } from '../../events/ids'
import { chainEvents } from '../chain-events'
import type { V2Body, V2Event } from '../event'
import { ESessionStatus, sessionStatusOf } from '../session-status'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'

const NOW = '2026-11-13T12:00:00.000Z'
const THREAD = toThreadId('t')
const RUN = toRunId('r')
const CALL = toCallId('c1')
const OTHER = toCallId('c2')

const eventsOf = (bodies: readonly V2Body[]): readonly V2Event[] =>
  chainEvents({ threadId: THREAD, runId: RUN, epoch: 1, at: NOW, bodies })

const statusOf = (bodies: readonly V2Body[]) =>
  sessionStatusOf({ events: eventsOf(bodies), live: true, queuedSince: null, now: NOW })

const ASKED: readonly V2Body[] = [
  { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
  { type: 'user-said', text: 'ask for the secret' },
  { type: 'assistant-said', parts: [] },
  { type: 'tool-called', callId: CALL, name: 'operator_input', ordinal: 0 },
  { type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
]

describe('a session waiting on a parked call', () => {
  it('reports the operator as the one being waited on, naming the tool', () => {
    expect(
      statusOf([...ASKED, { type: 'tool-parked', callId: CALL, name: 'operator_input' }]),
    ).toEqual({
      state: ESessionStatus.WaitingForOperator,
      reason: 'operator_input',
      since: NOW,
    })
  })

  it('keeps waiting while another call of the same step runs', () => {
    const status = statusOf([
      ...ASKED,
      { type: 'tool-called', callId: OTHER, name: 'read', ordinal: 1 },
      { type: 'tool-dispatched', callId: OTHER, name: 'read' },
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
    ])

    expect(status.state).toBe(ESessionStatus.WaitingForOperator)
    expect(status.reason).toBe('operator_input')
  })

  it('goes back to working once the result closes the parked call', () => {
    const status = statusOf([
      ...ASKED,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      { type: 'tool-result', callId: CALL, name: 'operator_input', modelText: 'hunter2' },
    ])

    expect(status.state).toBe(ESessionStatus.Thinking)
  })

  it('keeps waiting on the operator after the host closes the parked turn to release the pod', () => {
    const status = statusOf([
      ...ASKED,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      {
        type: 'turn-ended',
        turnId: 'turn-1',
        outcome: ETurnOutcome.Interrupted,
        by: ETurnEndedBy.Host,
      },
    ])

    expect(status).toEqual({
      state: ESessionStatus.WaitingForOperator,
      reason: 'operator_input',
      since: NOW,
    })
  })

  it('goes idle once the answer closes a call whose turn already ended', () => {
    const status = statusOf([
      ...ASKED,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      {
        type: 'turn-ended',
        turnId: 'turn-1',
        outcome: ETurnOutcome.Interrupted,
        by: ETurnEndedBy.Host,
      },
      { type: 'tool-result', callId: CALL, name: 'operator_input', modelText: 'cancelled' },
    ])

    expect(status.state).toBe(ESessionStatus.Idle)
  })

  it('reports a restored session waiting on the operator rather than resuming', () => {
    const status = sessionStatusOf({
      events: eventsOf([...ASKED, { type: 'tool-parked', callId: CALL, name: 'operator_input' }]),
      live: false,
      queuedSince: null,
      now: NOW,
    })

    expect(status.state).toBe(ESessionStatus.WaitingForOperator)
  })
})
