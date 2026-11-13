import { describe, expect, it } from 'bun:test'

import { log } from '../../assembly/__tests__/log-fixture'
import type { EventDraft } from '../../events/body'
import { toCallId } from '../../events/ids'
import { parkedResultDraft } from '../../events/parked-result'
import { crashedCalls, openParkedCall, pendingCalls } from '../../events/projections'
import { EResume, resumePlan, TOOL_PARKED_WAITING } from '../../events/resume-plan'
import {
  crashedCallsOf,
  initialLoopState,
  loopStateOf,
  isResumableOf,
  pendingCallsOf,
  resumePlanOf,
} from '../loop-state'

const CALL = toCallId('call-1')
const OTHER = toCallId('call-2')

const called = (
  callId: ReturnType<typeof toCallId>,
  name: string,
  ordinal: number,
): EventDraft => ({
  type: 'tool-called',
  callId,
  name,
  ordinal,
})

const promptThenCalls: readonly EventDraft[] = [
  { type: 'user-said', text: 'ask for the secret' },
  { type: 'assistant-said', parts: [] },
  called(CALL, 'operator_input', 0),
  { type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
]

describe('a parked call in the log', () => {
  it('keeps the call pending and dispatched, and blocks a resume while it is open', () => {
    const state = loopStateOf({
      events: log([
        ...promptThenCalls,
        { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      ]),
    })

    expect([...state.parked.keys()]).toEqual([CALL])
    expect(pendingCallsOf(state).map((call) => call.callId)).toEqual([CALL])
    expect(state.dispatched.has(CALL)).toBe(true)
    expect(resumePlanOf(state)).toEqual({ kind: EResume.Blocked, reason: TOOL_PARKED_WAITING })
    expect(isResumableOf(state)).toBe(false)
  })

  it('never treats a parked call as one a restart interrupted', () => {
    const state = loopStateOf({
      events: log([
        ...promptThenCalls,
        { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      ]),
    })

    expect(crashedCallsOf(state)).toEqual([])
  })

  it('continues without a nudge once a later result closes the parked call', () => {
    const events = log([
      ...promptThenCalls,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      { type: 'tool-result', callId: CALL, name: 'operator_input', modelText: 'hunter2' },
    ])

    const state = loopStateOf({ events })

    expect(state.parked.size).toBe(0)
    expect(pendingCallsOf(state)).toEqual([])
    expect(resumePlanOf(state)).toEqual({ kind: EResume.Continue, nudge: false })
    expect(isResumableOf(state)).toBe(true)
  })

  it('clears the parked call a denied call settles', () => {
    const state = loopStateOf({
      events: log([
        ...promptThenCalls,
        { type: 'tool-parked', callId: CALL, name: 'operator_input' },
        { type: 'tool-denied', callId: CALL, name: 'operator_input', reason: 'no' },
      ]),
    })

    expect(state.parked.size).toBe(0)
  })

  it('parks only the call that parked, recording the other results as usual', () => {
    const state = loopStateOf({
      events: log([
        ...promptThenCalls,
        called(OTHER, 'read', 1),
        { type: 'tool-dispatched', callId: OTHER, name: 'read' },
        { type: 'tool-result', callId: OTHER, name: 'read', output: 'file' },
        { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      ]),
    })

    expect([...state.parked.keys()]).toEqual([CALL])
    expect(pendingCallsOf(state).map((call) => call.callId)).toEqual([CALL])
  })

  it('forgets a parked call id that is called again by a rewound thread', () => {
    const state = loopStateOf({
      events: log([
        ...promptThenCalls,
        { type: 'tool-parked', callId: CALL, name: 'operator_input' },
        called(CALL, 'operator_input', 0),
      ]),
    })

    expect(state.parked.size).toBe(0)
  })
})

describe('reading open parked calls straight off the log', () => {
  it('reports the earliest parked call, and none once it settles', () => {
    const open = log([
      ...promptThenCalls,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
    ])
    const closed = log([
      ...promptThenCalls,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
      { type: 'tool-result', callId: CALL, name: 'operator_input' },
    ])

    expect(openParkedCall(open)).toBe(CALL)
    expect(openParkedCall(closed)).toBeUndefined()
    expect(pendingCalls(closed)).toEqual([])
    expect(crashedCalls(open)).toEqual([])
  })

  it('blocks the event-log resume plan while a parked call is open', () => {
    const events = log([
      ...promptThenCalls,
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
    ])

    expect(resumePlan(events)).toEqual({ kind: EResume.Blocked, reason: TOOL_PARKED_WAITING })
  })
})

describe('parkedResultDraft', () => {
  it('closes the parked call with the model text the operator produced', () => {
    expect(
      parkedResultDraft({ callId: CALL, name: 'operator_input', modelText: 'hunter2' }),
    ).toEqual({
      type: 'tool-result',
      callId: CALL,
      name: 'operator_input',
      modelText: 'hunter2',
    })
  })

  it('closes it with an error when the request failed or was cancelled', () => {
    expect(
      parkedResultDraft({ callId: CALL, name: 'operator_input', error: { message: 'cancelled' } }),
    ).toEqual({
      type: 'tool-result',
      callId: CALL,
      name: 'operator_input',
      error: { message: 'cancelled' },
    })
  })

  it('still writes a result body when no model text was given', () => {
    expect(parkedResultDraft({ callId: CALL, name: 'operator_input' })).toMatchObject({
      modelText: '',
    })
  })
})

describe('a fresh state', () => {
  it('parks nothing', () => {
    expect(initialLoopState().parked.size).toBe(0)
  })
})
