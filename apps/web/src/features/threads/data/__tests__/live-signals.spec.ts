import { describe, expect, it } from 'bun:test'

import { EStepEnd, toStepId, type ChannelSignal } from '@dltech/atlas-client/channel'
import { toCallId, toEventId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { absorbSignal, EMPTY_SIGNALS, MAX_TAIL_CHARACTERS, pruneSignals } from '../live-signals'

const step = toStepId('step_1')
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

const absorbAll = (signals: ChannelSignal[]) =>
  signals.reduce((state, signal) => absorbSignal({ state, signal }), EMPTY_SIGNALS)

const awaitedRef = { eventId: toEventId('evt_2'), seq: 2 }

const streaming: ChannelSignal[] = [
  { type: 'step-started', stepId: step },
  { type: 'chunk', stepId: step, chunk: { type: 'text-delta', id: 't', text: 'Hi' } },
]

const text: ChannelSignal[] = [
  ...streaming,
  { type: 'step-ended', stepId: step, end: EStepEnd.Completed, supersededBy: awaitedRef },
]

describe('absorbSignal', () => {
  it('keeps step signals and ignores the rest', () => {
    const state = absorbAll([
      ...text,
      { type: 'turn-working', working: true },
      { type: 'events-appended' },
      { type: 'context-changed' },
    ])
    expect(state.signals.map((signal) => signal.type)).toEqual([
      'step-started',
      'chunk',
      'step-ended',
    ])
  })

  it('accumulates tool output per call and caps the tail', () => {
    const state = absorbAll([
      { type: 'tool-output', callId: call, text: 'a' },
      { type: 'tool-output', callId: call, text: 'b'.repeat(MAX_TAIL_CHARACTERS) },
    ])
    const tail = state.outputs.get(call) ?? ''
    expect(tail).toHaveLength(MAX_TAIL_CHARACTERS)
    expect(tail.startsWith('a')).toBe(false)
    expect(state.signals).toEqual([])
  })
})

describe('pruneSignals', () => {
  it('keeps a step that is streaming, or ended but waiting for its durable event', () => {
    const state = absorbAll(text)
    const events = eventsFromWire([wire(1, { type: 'user-said', text: 'hi' })])
    expect(pruneSignals({ state, events }).signals).toHaveLength(3)
  })

  it('drops a step that ended with no durable event to wait for', () => {
    const state = absorbAll([
      ...streaming,
      { type: 'step-ended', stepId: step, end: EStepEnd.Completed, supersededBy: null },
    ])
    expect(pruneSignals({ state, events: [] }).signals).toEqual([])
  })

  it('drops the step once the durable assistant event lands', () => {
    const state = absorbAll(text)
    const events = eventsFromWire([
      wire(1, { type: 'user-said', text: 'hi' }),
      wire(2, { type: 'assistant-said', parts: [{ type: 'text', text: 'Hi' }] }),
    ])
    expect(pruneSignals({ state, events }).signals).toEqual([])
  })

  it('drops tool output once the call settles and keeps it while running', () => {
    const state = absorbAll([{ type: 'tool-output', callId: call, text: 'out' }])
    const running = eventsFromWire([
      wire(1, { type: 'tool-called', callId: 'call_1', name: 'bash', input: {}, ordinal: 0 }),
    ])
    expect(pruneSignals({ state, events: running }).outputs.get(call)).toBe('out')
    const done = eventsFromWire([
      wire(1, { type: 'tool-called', callId: 'call_1', name: 'bash', input: {}, ordinal: 0 }),
      wire(2, { type: 'tool-result', callId: 'call_1', name: 'bash' }),
    ])
    expect(pruneSignals({ state, events: done }).outputs.size).toBe(0)
  })

  it('returns the same state when nothing is pruned', () => {
    const state = absorbAll(streaming)
    const events = eventsFromWire([wire(1, { type: 'user-said', text: 'hi' })])
    expect(pruneSignals({ state, events })).toBe(state)
  })
})
