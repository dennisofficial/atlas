import { describe, expect, it } from 'bun:test'

import {
  EClientFrame,
  EServeFrame,
  EStepEnd,
  toStepId,
  type ChannelSignal,
} from '@dltech/atlas-client/channel'
import { stepsOfMessages } from '@dltech/atlas-client/chat'
import { liveSteps } from '@dltech/atlas-client/transcript'
import { toCallId, toEventId, type CallId } from '@dltech/atlas-core'
import type { InFlightStep } from '@dltech/atlas-client/transcript'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { threadSourceOf } from '../thread-source'
import { durableTranscriptOf, ETranscriptKind, transcriptViewOf } from '../transcript-items'
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
    test.pruneTo(eventsFromWire(test.state().events))
    await flush()
  }
  return { test, signal, appendAndRead }
}

const stateOf = (test: Awaited<ReturnType<typeof liveRig>>['test']) => ({
  events: test.state().events,
  steps: stepsOfMessages(test.chat.messages),
  outputs: test.state().outputs,
})

const viewOf = (state: {
  events: WireEvent[]
  steps: InFlightStep[]
  outputs?: ReadonlyMap<CallId, string>
}) => {
  const events = eventsFromWire(state.events)
  return transcriptViewOf({
    durable: durableTranscriptOf({ events }),
    live: liveSteps({ steps: state.steps, events }),
    outputs: state.outputs,
  })
}

describe('the live controller and step signals', () => {
  it('shows a streaming agent entry from a server-initiated step, with no send', async () => {
    const { test, signal } = await liveRig()
    for (const next of streamingText) await signal(next)

    expect(test.chat.messages.map((message) => message.id)).toEqual([step])
    const agent = viewOf(stateOf(test)).items.find((item) => item.kind === ETranscriptKind.Agent)
    expect(agent).toMatchObject({ text: 'Hello there', streaming: true })
    expect(test.socket().sent.some((frame) => frame.kind === EClientFrame.Send)).toBe(false)
  })

  it('claims a second step after the first one ended', async () => {
    const { test, signal } = await liveRig()
    for (const next of [...streamingText, endedByReply]) await signal(next)
    const second = toStepId('step_2')
    await signal({ type: 'step-started', stepId: second })
    await signal({
      type: 'chunk',
      stepId: second,
      chunk: { type: 'text-delta', id: 't', text: 'More' },
    })

    expect(test.chat.messages.map((message) => message.id)).toEqual([step, second])
  })

  it('drops the step from the chat once the durable assistant event lands', async () => {
    const { test, signal, appendAndRead } = await liveRig()
    for (const next of [...streamingText, endedByReply]) await signal(next)
    expect(test.chat.messages).toHaveLength(1)

    await appendAndRead([reply])

    expect(test.chat.messages).toEqual([])
    const agent = viewOf(stateOf(test)).items.find((item) => item.kind === ETranscriptKind.Agent)
    expect(agent).toMatchObject({ text: 'Hello there', streaming: false })
  })

  it('keeps a step that is still streaming when unrelated events land', async () => {
    const { test, signal, appendAndRead } = await liveRig()
    for (const next of streamingText) await signal(next)

    await appendAndRead([toolCalled])

    expect(test.chat.messages).toHaveLength(1)
  })

  it('clears the chat when the channel reloads', async () => {
    const { test, signal } = await liveRig()
    for (const next of streamingText) await signal(next)

    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 })
    await flush()

    expect(test.chat.messages).toEqual([])
  })

  it('keeps a step that opens while a reload is still stopping the chat', async () => {
    const { test, signal } = await liveRig()
    for (const next of streamingText) await signal(next)
    const stopChat = test.chat.stop.bind(test.chat)
    let releaseStop: () => void = () => undefined
    const stopGate = new Promise<void>((done) => {
      releaseStop = done
    })
    test.chat.stop = async () => {
      await stopGate
      await stopChat()
    }
    const next = toStepId('step_2')

    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 })
    await signal({ type: 'step-started', stepId: next })
    await signal({
      type: 'chunk',
      stepId: next,
      chunk: { type: 'text-delta', id: 't', text: 'fresh' },
    })
    releaseStop()
    await flush()

    expect(stepsOfMessages(test.chat.messages).map((held) => held.stepId)).toEqual([next])
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

  it('clears the chat and outputs when it falls back', async () => {
    const { test, signal } = await liveRig()
    for (const next of streamingText) await signal(next)
    await signal({ type: 'tool-output', callId: call, text: 'ab' })
    expect(test.chat.messages).toHaveLength(1)

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    await flush()

    expect(test.state().live).toBe(false)
    expect(test.chat.messages).toEqual([])
    expect(test.state().outputs.size).toBe(0)
  })

  it('yields the same transcript items live as polling does for the same durable events', async () => {
    const { test, signal, appendAndRead } = await liveRig()
    for (const next of [...streamingText, endedByReply]) await signal(next)
    await appendAndRead([reply])

    const live = threadSourceOf({
      live: { ...test.state(), steps: stepsOfMessages(test.chat.messages), send: () => false },
      polled: { events: [], loaded: false, error: null },
    })
    const polled = threadSourceOf({
      live: { ...test.state(), steps: [], live: false, send: () => false },
      polled: { events: [userHi, reply], loaded: true, error: null },
    })

    const itemsOf = (source: typeof live) => viewOf(source).items
    expect(itemsOf(live)).toEqual(itemsOf(polled))
    expect(itemsOf(live).map((item) => item.kind)).toEqual([
      ETranscriptKind.User,
      ETranscriptKind.Agent,
    ])
  })
})
