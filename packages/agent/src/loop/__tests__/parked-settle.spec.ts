import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  parkedOutcomeOf,
  parkedResultDraft,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
  type PendingCall,
  type ToolCall,
} from '@dltech/atlas-core'

import { FakeTool } from '../../testing'
import { rigOf, sayDraft, THREAD as RIG_THREAD } from '../../__tests__/exit-fixture'
import { resultDraft } from '../../tools/tool-result-draft'
import { ETurnStatus } from '../turn-outcome'
import { settlePendingCall } from '../turn-position'

const CALL = toCallId('call-1')
const THREAD = toThreadId('thread-1')
const RUN = toRunId('run-1')

const call: ToolCall = {
  callId: CALL,
  name: 'operator_input',
  input: {},
  effect: EToolEffect.Read,
  threadId: THREAD,
}

const pending: PendingCall = {
  callId: CALL,
  name: 'operator_input',
  input: {},
  ordinal: 0,
  runId: RUN,
  threadId: THREAD,
}

describe('drafting a parked tool outcome', () => {
  it('records the call as parked instead of writing a result', () => {
    const draft = resultDraft({
      call,
      result: parkedOutcomeOf('waiting for the operator'),
      interrupted: false,
    })

    expect(draft).toEqual({ type: 'tool-parked', callId: CALL, name: 'operator_input' })
  })
})

describe('settling a call that parks', () => {
  it('ends the turn at the park rather than restarting the iteration', async () => {
    const settled = await settlePendingCall({
      pending,
      threadId: THREAD,
      settlePending: async () => ({ parked: { callId: CALL, name: 'operator_input' } }),
      settleAttempted: undefined,
      signal: new AbortController().signal,
    })

    expect(settled).toEqual({ kind: 'parked', callId: CALL, name: 'operator_input' })
  })

  it('still restarts the iteration when nothing parked', async () => {
    const settled = await settlePendingCall({
      pending,
      threadId: THREAD,
      settlePending: async () => ({}),
      settleAttempted: undefined,
      signal: new AbortController().signal,
    })

    expect(settled).toEqual({ kind: 'settled' })
  })

  it('reports a pause before a park when dispatch asked the operator', async () => {
    const settled = await settlePendingCall({
      pending,
      threadId: THREAD,
      settlePending: async () => ({
        paused: { callId: CALL, reason: 'awaiting approval' },
        parked: { callId: CALL, name: 'operator_input' },
      }),
      settleAttempted: undefined,
      signal: new AbortController().signal,
    })

    expect(settled).toEqual({ kind: 'paused', callId: CALL, reason: 'awaiting approval' })
  })
})

const parkedLog = (): EventDraft[] => [
  sayDraft('ask for the secret'),
  { type: 'assistant-said', parts: [] },
  { type: 'tool-called', callId: CALL, name: 'operator_input', input: {}, ordinal: 0 },
  { type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
  { type: 'tool-parked', callId: CALL, name: 'operator_input' },
]

const turnWithParkedCall = async (args: {
  intakeDrafts: readonly EventDraft[]
  wakesTurn?: boolean
}) => {
  const tool = new FakeTool('operator_input', 'a value')
  const rig = rigOf({ script: [{ text: 'unused' }], tools: [tool] })
  await rig.record.append({ threadId: RIG_THREAD, runId: RUN, drafts: parkedLog() })
  rig.intake.enqueue({ drafts: args.intakeDrafts, wakesTurn: args.wakesTurn ?? false })
  const outcome = await rig.runner.runTurn({ threadId: RIG_THREAD })
  return { rig, tool, outcome }
}

describe('a turn that starts with an open parked call', () => {
  it('ends parked without re-running the tool or calling the model', async () => {
    const { rig, tool, outcome } = await turnWithParkedCall({ intakeDrafts: [] })

    expect(outcome).toMatchObject({ status: ETurnStatus.Parked, callId: CALL })
    expect(tool.invocations).toHaveLength(0)
    expect(rig.model.requests).toHaveLength(0)
    expect(
      rig.record.eventsOf(RIG_THREAD).filter((event) => event.type === 'tool-called'),
    ).toHaveLength(1)
  })

  it('calls the model with the answer once the intake closes the call', async () => {
    const { rig, tool, outcome } = await turnWithParkedCall({
      intakeDrafts: [
        parkedResultDraft({
          callId: CALL,
          name: 'operator_input',
          modelText: 'the value is in the file',
        }),
      ],
      wakesTurn: true,
    })

    expect(outcome).not.toMatchObject({ status: ETurnStatus.Parked })
    expect(tool.invocations).toHaveLength(0)
    expect(rig.model.requests).toHaveLength(1)
    expect(JSON.stringify(rig.model.requests[0]?.assembled.messages)).toContain('in the file')
  })
})
