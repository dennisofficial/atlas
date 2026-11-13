import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  parkedOutcomeOf,
  toCallId,
  toRunId,
  toThreadId,
  type PendingCall,
  type ToolCall,
} from '@dltech/atlas-core'

import { resultDraft } from '../../tools/tool-result-draft'
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
