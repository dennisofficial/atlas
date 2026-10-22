import { describe, expect, it } from 'bun:test'

import { EStepEnd, toStepId, type StepSignal } from '@dltech/atlas-client/channel'
import { toCallId } from '@dltech/atlas-core'
import { EToolState } from '@dltech/atlas-ui/ai/tool'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { ETranscriptKind, isTextStreaming, transcriptViewOf } from '../transcript-items'

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const said = (seq: number, text: string) => wire(seq, { type: 'user-said', text })
const called = (seq: number, callId: string, input: unknown) =>
  wire(seq, { type: 'tool-called', callId, name: 'bash', input, ordinal: 0 })
const result = (seq: number, callId: string, extra: Record<string, unknown>) =>
  wire(seq, { type: 'tool-result', callId, name: 'bash', ...extra })

const step = toStepId('step_1')
const started: StepSignal = { type: 'step-started', stepId: step }
const chunk = (body: Extract<StepSignal, { type: 'chunk' }>['chunk']): StepSignal => ({
  type: 'chunk',
  stepId: step,
  chunk: body,
})
const viewOf = (args: { events: WireEvent[]; signals?: StepSignal[] }) =>
  transcriptViewOf({ events: eventsFromWire(args.events), signals: args.signals ?? [] })

describe('transcriptViewOf', () => {
  it('shows streaming text as a streaming agent item after the user message', () => {
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({ type: 'text-start', id: 't1' }),
        chunk({ type: 'text-delta', id: 't1', text: 'Hel' }),
        chunk({ type: 'text-delta', id: 't1', text: 'lo' }),
      ],
    })
    expect(view.items.map((item) => item.kind)).toEqual([
      ETranscriptKind.User,
      ETranscriptKind.Agent,
    ])
    expect(view.items[1]).toMatchObject({ text: 'Hello', streaming: true })
    expect(view.streaming).toBe(true)
    expect(isTextStreaming(view.items)).toBe(true)
  })

  it('maps reasoning chunks to a thought item', () => {
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({ type: 'reasoning-start', id: 'r1' }),
        chunk({ type: 'reasoning-delta', id: 'r1', text: 'weighing options' }),
      ],
    })
    expect(view.items[1]).toMatchObject({
      kind: ETranscriptKind.Thought,
      text: 'weighing options',
      streaming: true,
    })
  })

  it('shows a call still being dictated as a running tool', () => {
    const callId = toCallId('call_1')
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({ type: 'tool-call', callId, name: 'bash', input: { command: 'ls' } }),
      ],
    })
    const tools = view.items[1]
    expect(tools).toMatchObject({ kind: ETranscriptKind.Tools })
    if (tools?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    expect(tools.calls[0]).toMatchObject({ state: EToolState.Running, label: 'ls' })
  })

  it('shows a dispatched call with no result as running', () => {
    const view = viewOf({ events: [said(1, 'hi'), called(2, 'call_1', { command: 'ls' })] })
    const tools = view.items[1]
    if (tools?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    expect(tools.calls[0]?.state).toBe(EToolState.Running)
  })

  it('settles a durable result as done with its output', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        called(2, 'call_1', { command: 'ls' }),
        result(3, 'call_1', { output: {}, modelText: 'a.ts\nb.ts' }),
      ],
    })
    const tools = view.items[1]
    if (tools?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    expect(tools.calls[0]).toMatchObject({
      state: EToolState.Done,
      output: 'a.ts\nb.ts',
      elapsed: '1s',
    })
  })

  it('settles an errored result as an error with its message', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        called(2, 'call_1', { command: 'boom' }),
        result(3, 'call_1', { error: { message: 'exit 1' } }),
      ],
    })
    const tools = view.items[1]
    if (tools?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    expect(tools.calls[0]).toMatchObject({ state: EToolState.Error, errorText: 'exit 1' })
  })

  it('maps a denied call and one awaiting approval', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        called(2, 'call_1', { command: 'rm -rf /' }),
        wire(3, { type: 'tool-denied', callId: 'call_1', name: 'bash', reason: 'no' }),
        called(4, 'call_2', { command: 'git push' }),
        wire(5, { type: 'approval-requested', callId: 'call_2', reason: 'pushes' }),
      ],
    })
    const states = view.items.flatMap((item) =>
      item.kind === ETranscriptKind.Tools ? item.calls.map((call) => call.state) : [],
    )
    expect(states).toEqual([EToolState.Denied, EToolState.AwaitingApproval])
  })

  it('drops the streamed step once its durable event has landed', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        wire(2, { type: 'assistant-said', parts: [{ type: 'text', text: 'Hello' }] }),
      ],
      signals: [
        started,
        chunk({ type: 'text-delta', id: 't1', text: 'Hello' }),
        { type: 'step-ended', stepId: step, end: EStepEnd.Completed, supersededBy: null },
      ],
    })
    const agents = view.items.filter((item) => item.kind === ETranscriptKind.Agent)
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ text: 'Hello', streaming: false })
  })

  it('reports a failed step as the failure', () => {
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({ type: 'error', message: 'provider overloaded' }),
        { type: 'step-ended', stepId: step, end: EStepEnd.Failed, supersededBy: null },
      ],
    })
    expect(view.failure).toBe('provider overloaded')
  })

  it('skips legacy boot rows', () => {
    const boot: WireEvent = { ...said(1, 'x'), type: 'sandbox-boot-step', body: '{"step":"a"}' }
    expect(viewOf({ events: [boot, said(2, 'hi')] }).items).toHaveLength(1)
  })
})
