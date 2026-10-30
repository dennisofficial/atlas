import { describe, expect, it } from 'bun:test'

import { EStepEnd, toStepId, type StepSignal } from '@dltech/atlas-client/channel'
import { liveSteps, stepsOfSignals } from '@dltech/atlas-client/transcript'
import { toCallId } from '@dltech/atlas-core'
import { EToolState } from '@dltech/atlas-ui/ai/tool'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import {
  durableTranscriptOf,
  EToolFamily,
  ETranscriptKind,
  isTextStreaming,
  transcriptViewOf,
} from '../transcript-items'

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
const viewOf = (args: { events: WireEvent[]; signals?: StepSignal[] }) => {
  const events = eventsFromWire(args.events)
  return transcriptViewOf({
    durable: durableTranscriptOf({ events }),
    live: liveSteps({ steps: stepsOfSignals(args.signals ?? []), events }),
  })
}

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

  it('drops a settled thought once later work follows it', () => {
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({ type: 'reasoning-start', id: 'r1' }),
        chunk({ type: 'reasoning-delta', id: 'r1', text: 'weighing options' }),
        chunk({ type: 'reasoning-end', id: 'r1' }),
        chunk({ type: 'text-start', id: 't1' }),
        chunk({ type: 'text-delta', id: 't1', text: 'Done' }),
      ],
    })
    expect(view.items.map((item) => item.kind)).toEqual([
      ETranscriptKind.User,
      ETranscriptKind.Agent,
    ])
  })

  it('keeps the trailing thought live while the tools it opened run', () => {
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({ type: 'reasoning-start', id: 'r1' }),
        chunk({ type: 'reasoning-delta', id: 'r1', text: 'check the tree' }),
        chunk({ type: 'reasoning-end', id: 'r1' }),
        chunk({
          type: 'tool-call',
          callId: toCallId('call_1'),
          name: 'bash',
          input: { command: 'ls' },
        }),
      ],
    })
    const last = view.items.at(-1)
    expect(last).toMatchObject({ kind: ETranscriptKind.Thought, text: 'check the tree' })
    if (last?.kind !== ETranscriptKind.Thought) throw new Error('expected a thought item')
    expect(last.streaming || last.heldOpen).toBe(true)
  })

  it('shows a call still being dictated as a running tool', () => {
    const callId = toCallId('call_1')
    const view = viewOf({
      events: [said(1, 'hi')],
      signals: [
        started,
        chunk({
          type: 'tool-call',
          callId,
          name: 'bash',
          input: { command: 'ls' },
        }),
      ],
    })
    const tools = view.items[1]
    expect(tools).toMatchObject({ kind: ETranscriptKind.Tools })
    if (tools?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    expect(tools.calls[0]).toMatchObject({
      state: EToolState.Running,
      label: 'ls',
    })
  })

  it('shows a dispatched call with no result as running', () => {
    const view = viewOf({
      events: [said(1, 'hi'), called(2, 'call_1', { command: 'ls' })],
    })
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
    expect(tools.calls[0]).toMatchObject({
      state: EToolState.Error,
      errorText: 'exit 1',
    })
  })

  it('maps a denied call and one awaiting approval', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        called(2, 'call_1', { command: 'rm -rf /' }),
        wire(3, {
          type: 'tool-denied',
          callId: 'call_1',
          name: 'bash',
          reason: 'no',
        }),
        called(4, 'call_2', { command: 'git push' }),
        wire(5, {
          type: 'approval-requested',
          callId: 'call_2',
          reason: 'pushes',
        }),
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
        wire(2, {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'Hello' }],
        }),
      ],
      signals: [
        started,
        chunk({ type: 'text-delta', id: 't1', text: 'Hello' }),
        {
          type: 'step-ended',
          stepId: step,
          end: EStepEnd.Completed,
          supersededBy: null,
        },
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
        {
          type: 'step-ended',
          stepId: step,
          end: EStepEnd.Failed,
          supersededBy: null,
        },
      ],
    })
    expect(view.failure).toBe('provider overloaded')
  })

  it('skips legacy boot rows', () => {
    const boot: WireEvent = {
      ...said(1, 'x'),
      type: 'sandbox-boot-step',
      body: '{"step":"a"}',
    }
    expect(viewOf({ events: [boot, said(2, 'hi')] }).items).toHaveLength(1)
  })

  it('stamps durable items with their event time and leaves live ones unstamped', () => {
    const view = viewOf({
      events: [said(1, 'hi'), called(2, 'call_1', { command: 'ls' })],
      signals: [
        started,
        chunk({ type: 'text-start', id: 't1' }),
        chunk({ type: 'text-delta', id: 't1', text: 'ok' }),
      ],
    })
    expect(view.items[0]?.at).toBe('2026-10-22T10:00:01.000Z')
    expect(view.items[1]).toMatchObject({
      kind: ETranscriptKind.Tools,
      at: '2026-10-22T10:00:02.000Z',
    })
    const live = view.items.at(-1)
    expect(live).toMatchObject({
      kind: ETranscriptKind.Agent,
      streaming: true,
    })
    expect(live?.at).toBeUndefined()
  })

  it('stamps an assistant message with its event time', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        wire(2, {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'done' }],
        }),
      ],
    })
    expect(view.items[1]).toMatchObject({
      kind: ETranscriptKind.Agent,
      at: '2026-10-22T10:00:02.000Z',
    })
  })
})

describe('tool titles', () => {
  const toolItem = (name: string, input: unknown, output: Record<string, unknown> = {}) => {
    const callId = 'call_1'
    const view = viewOf({
      events: [
        said(1, 'hi'),
        wire(2, { type: 'tool-called', callId, name, input, ordinal: 0 }),
        wire(3, { type: 'tool-result', callId, name, output, modelText: '' }),
      ],
    })
    const item = view.items[1]
    if (item?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    return item.calls[0]
  }

  it('phrases a spawn by what it was spawned for', () => {
    expect(toolItem('agent_spawn', { agentType: 'explore', intent: 'vault audit' })).toMatchObject({
      title: 'Spawned vault audit',
      family: EToolFamily.Agent,
    })
  })

  it('phrases a plan update', () => {
    expect(toolItem('task_write', { tasks: [] })).toMatchObject({
      title: 'Updated the plan',
      family: EToolFamily.Plan,
    })
  })

  it('falls back to Called <name> for an unknown tool', () => {
    expect(toolItem('mystery', {})).toMatchObject({
      title: 'Called mystery',
      family: EToolFamily.Other,
    })
  })

  it('leaves tools with a dedicated kind untitled', () => {
    const call = toolItem('bash', { command: 'ls' })
    expect(call?.title).toBeUndefined()
    expect(call?.family).toBeUndefined()
  })

  it('does not title a call that is still running', () => {
    const view = viewOf({
      events: [
        said(1, 'hi'),
        wire(2, {
          type: 'tool-called',
          callId: 'c',
          name: 'mystery',
          input: {},
          ordinal: 0,
        }),
      ],
    })
    const item = view.items[1]
    if (item?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    expect(item.calls[0]?.title).toBeUndefined()
  })

  it('carries pasted images on the user item', () => {
    const shot = { path: 'shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }
    const view = viewOf({ events: [wire(1, { type: 'user-said', text: 'look', images: [shot] })] })
    expect(view.items[0]).toMatchObject({ kind: ETranscriptKind.User, images: [shot] })
  })

  it('keeps a message that is only a pasted image', () => {
    const shot = { path: 'shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }
    const view = viewOf({ events: [wire(1, { type: 'user-said', text: '', images: [shot] })] })
    expect(view.items).toHaveLength(1)
    expect(view.items[0]).toMatchObject({ kind: ETranscriptKind.User, text: '', images: [shot] })
  })
})

describe('upload-only messages', () => {
  it('keeps a user message that has uploads but no text', () => {
    const uploads = [
      {
        uploadId: '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01',
        pathname: 'p',
        name: 'a.pdf',
        size: 1,
        mediaType: 'x/y',
      },
    ]
    const view = viewOf({ events: [wire(1, { type: 'user-said', text: '', uploads })] })
    expect(view.items[0]).toMatchObject({ kind: ETranscriptKind.User, uploads })
  })
})
