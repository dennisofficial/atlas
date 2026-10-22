import { describe, expect, it } from 'bun:test'

import {
  EServeFrame,
  EStepEnd,
  toStepId,
  type ChannelSignal,
  type StepSignal,
} from '@dltech/atlas-client/channel'
import { toCallId, toEventId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { threadSourceOf } from '../thread-source'
import { ETranscriptKind, transcriptViewOf } from '../transcript-items'
import { flush, rig } from './live-thread-fixture'

const step = toStepId('step_1')
const call = toCallId('call_1')

const said = (args: { seq: number; body: Record<string, unknown> }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T22:49:00.000Z',
  type: String(args.body.type),
  body: JSON.stringify(args.body),
})

const userHi = said({ seq: 1, body: { type: 'user-said', text: 'Hi' } })
const reply = said({
  seq: 2,
  body: { type: 'assistant-said', parts: [{ type: 'text', text: 'Hello there' }] },
})
const toolCalled = said({
  seq: 2,
  body: { type: 'tool-called', callId: 'call_1', name: 'bash', input: {}, ordinal: 0 },
})
const toolResult = said({ seq: 3, body: { type: 'tool-result', callId: 'call_1', name: 'bash' } })

const streamingText: ChannelSignal[] = [
  { type: 'step-started', stepId: step },
  { type: 'chunk', stepId: step, chunk: { type: 'text-delta', id: 't', text: 'Hello there' } },
]

const endedByReply: ChannelSignal = {
  type: 'step-ended',
  stepId: step,
  end: EStepEnd.Completed,
  supersededBy: { eventId: toEventId('evt_2'), seq: 2 },
}

async function liveRig(seed: WireEvent[] = [userHi]) {
  const test = rig({ seed })
  test.controller.start()
  await flush()
  test.ready()
  await flush()
  let frameSeq = 0
  const signal = async (next: ChannelSignal) => {
    frameSeq += 1
    test.receive({ kind: EServeFrame.Signal, seq: frameSeq, signal: next })
    await flush()
  }
  const appendAndRead = async (events: WireEvent[]) => {
    const before = test.requests().length
    await signal({ type: 'events-appended' })
    test.answer({ index: before, events })
    await flush()
  }
  return { test, signal, appendAndRead }
}

const viewOf = (state: { events: WireEvent[]; signals: StepSignal[] }) =>
  transcriptViewOf({ events: eventsFromWire(state.events), signals: state.signals })

describe('the live controller and step signals', () => {
  it('keeps step-started and text chunks and shows a streaming agent entry', async () => {
    const { test, signal } = await liveRig()
    for (const next of streamingText) await signal(next)

    expect(test.state().signals.map((entry) => entry.type)).toEqual(['step-started', 'chunk'])
    const agent = viewOf(test.state()).items.find((item) => item.kind === ETranscriptKind.Agent)
    expect(agent).toMatchObject({ text: 'Hello there', streaming: true })
  })

  it('prunes the signals once the durable assistant event lands', async () => {
    const { test, signal, appendAndRead } = await liveRig()
    for (const next of [...streamingText, endedByReply]) await signal(next)
    expect(test.state().signals).toHaveLength(3)

    await appendAndRead([reply])

    expect(test.state().signals).toEqual([])
    const agent = viewOf(test.state()).items.find((item) => item.kind === ETranscriptKind.Agent)
    expect(agent).toMatchObject({ text: 'Hello there', streaming: false })
  })

  it('accumulates tool output per call and drops it when the call settles', async () => {
    const { test, signal, appendAndRead } = await liveRig()
    await signal({ type: 'tool-output', callId: call, text: 'ab' })
    await signal({ type: 'tool-output', callId: call, text: 'cd' })
    expect(test.state().outputs.get(call)).toBe('abcd')

    await appendAndRead([toolCalled])
    expect(test.state().outputs.get(call)).toBe('abcd')

    await appendAndRead([toolResult])
    expect(test.state().outputs.size).toBe(0)
  })

  it('clears signals and outputs when it falls back', async () => {
    const { test, signal } = await liveRig()
    for (const next of streamingText) await signal(next)
    await signal({ type: 'tool-output', callId: call, text: 'ab' })
    expect(test.state().signals).toHaveLength(2)

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    await flush()

    expect(test.state().live).toBe(false)
    expect(test.state().signals).toEqual([])
    expect(test.state().outputs.size).toBe(0)
  })

  it('yields the same transcript items live as polling does for the same durable events', async () => {
    const { test, signal, appendAndRead } = await liveRig()
    for (const next of [...streamingText, endedByReply]) await signal(next)
    await appendAndRead([reply])

    const live = threadSourceOf({
      live: { ...test.state(), send: () => false },
      polled: { events: [], loaded: false, error: null },
    })
    const polled = threadSourceOf({
      live: { ...test.state(), live: false, send: () => false },
      polled: { events: [userHi, reply], loaded: true, error: null },
    })

    const itemsOf = (source: typeof live) =>
      transcriptViewOf({
        events: eventsFromWire(source.events),
        signals: source.signals,
        outputs: source.outputs,
      }).items
    expect(itemsOf(live)).toEqual(itemsOf(polled))
    expect(itemsOf(live).map((item) => item.kind)).toEqual([
      ETranscriptKind.User,
      ETranscriptKind.Agent,
    ])
  })
})
