import { describe, expect, it } from 'bun:test'

import { toCallId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import {
  absorbOutput,
  EMPTY_OUTPUTS,
  isStepSignal,
  MAX_TAIL_CHARACTERS,
  pruneOutputs,
} from '../live-signals'

const call = toCallId('call_1')

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: String(body.type),
  body: JSON.stringify(body),
})

describe('absorbOutput', () => {
  it('ignores every signal but tool output', () => {
    expect(
      absorbOutput({ state: EMPTY_OUTPUTS, signal: { type: 'turn-working', working: true } }),
    ).toBe(EMPTY_OUTPUTS)
    expect(absorbOutput({ state: EMPTY_OUTPUTS, signal: { type: 'events-appended' } })).toBe(
      EMPTY_OUTPUTS,
    )
  })

  it('accumulates tool output per call and caps the tail', () => {
    const first = absorbOutput({
      state: EMPTY_OUTPUTS,
      signal: { type: 'tool-output', callId: call, text: 'a' },
    })
    const state = absorbOutput({
      state: first,
      signal: { type: 'tool-output', callId: call, text: 'b'.repeat(MAX_TAIL_CHARACTERS) },
    })
    const tail = state.outputs.get(call) ?? ''
    expect(tail).toHaveLength(MAX_TAIL_CHARACTERS)
    expect(tail.startsWith('a')).toBe(false)
  })
})

describe('isStepSignal', () => {
  it('accepts step signals and rejects channel-level ones', () => {
    expect(isStepSignal({ type: 'step-started', stepId: 'step_1' as never })).toBe(true)
    expect(isStepSignal({ type: 'events-appended' })).toBe(false)
  })
})

describe('pruneOutputs', () => {
  const state = absorbOutput({
    state: EMPTY_OUTPUTS,
    signal: { type: 'tool-output', callId: call, text: 'out' },
  })
  const called = wire(1, {
    type: 'tool-called',
    callId: 'call_1',
    name: 'bash',
    input: {},
    ordinal: 0,
  })

  it('keeps output while the call runs and drops it once settled', () => {
    expect(pruneOutputs({ state, events: eventsFromWire([called]) }).outputs.get(call)).toBe('out')
    const done = eventsFromWire([
      called,
      wire(2, { type: 'tool-result', callId: 'call_1', name: 'bash' }),
    ])
    expect(pruneOutputs({ state, events: done }).outputs.size).toBe(0)
  })

  it('returns the same state when nothing is pruned', () => {
    expect(pruneOutputs({ state, events: [] })).toBe(state)
  })
})
