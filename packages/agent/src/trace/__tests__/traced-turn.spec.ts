import { describe, expect, it } from 'bun:test'

import { EFinishReason, ERunFailureKind, toRunId, type Chunk } from '@dltech/atlas-core'
import { ESpan, ESpanMark, ESpanOutcome, ESpanSpeed, ETurnEntry } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { THREAD, rigOf } from '../../__tests__/exit-fixture'
import { HookChain } from '../../hooks/registry'
import { FakeTool, fakeToolRegistry } from '../../testing'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { ModelStreamError } from '../../model/errors'
import { ETurnStatus } from '../../loop/turn-outcome'
import type { AgentRecordPort } from '../../record/agent-record.port'
import { FirstTokenClock } from '../first-token'
import { TracedModel } from '../traced-model'
import { traceTurn } from '../traced-turn-deps'

describe('traced turn', () => {
  it('nests model calls, tool spans and record writes under one root turn span', async () => {
    const trace = new RecordingTracer()
    const tool = new FakeTool('read', 'contents')
    const registry = fakeToolRegistry([tool])
    const { runner } = rigOf({
      script: [{ calls: [{ callId: 'c1', name: 'read', input: {} }] }, { text: 'done' }],
      tools: [tool],
      overrides: {
        trace,
        dispatch: new HookedToolDispatcher({ registry, hooks: new HookChain({}), trace }),
      },
    })

    await runner.say({ threadId: THREAD, text: 'go' })

    const [turn, ...extraTurns] = trace.named(ESpan.Turn)
    expect(extraTurns).toEqual([])
    expect(turn?.parent).toBeUndefined()
    expect(turn?.fields).toMatchObject({
      threadId: THREAD,
      provider: 'scripted',
      status: 'completed',
      entry: ETurnEntry.Start,
    })

    const calls = trace.named(ESpan.ModelCall)
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.parent === turn)).toBe(true)
    expect(calls[0]?.fields.toolCalls).toBe(1)
    expect(calls[0]?.fields.sizes?.total).toBeGreaterThan(0)
    expect(calls[0]?.fields.sizes?.messages).toBeGreaterThan(0)
    expect(calls[0]?.fields.hashes?.tools).toMatch(/^[0-9a-f]{8}$/)
    expect(calls[0]?.fields.speed).toBe(ESpanSpeed.Standard)

    const [toolSpan] = trace.named(ESpan.Tool)
    expect(toolSpan?.fields).toMatchObject({ tool: 'read', callId: 'c1', outcome: ESpanOutcome.Ok })
    const [invoke] = trace.named(ESpan.ToolInvoke)
    expect(invoke?.parent).toBe(toolSpan)
    expect(trace.named(ESpan.ToolHooks)[0]?.parent).toBe(toolSpan)

    expect(trace.named(ESpan.ContextPrepare).length).toBeGreaterThanOrEqual(2)
    expect(trace.named(ESpan.RecordAppend).length).toBeGreaterThan(0)
    expect(trace.spans.every((span) => span.ended)).toBe(true)
  })

  it('marks a turn resumed from the log apart from one a message started', async () => {
    const trace = new RecordingTracer()
    const { runner } = rigOf({
      script: [{ text: 'first' }, { text: 'again' }],
      overrides: { trace },
    })

    await runner.say({ threadId: THREAD, text: 'go' })
    await runner.resume({ threadId: THREAD })

    expect(trace.named(ESpan.Turn).map((turn) => turn.fields.entry)).toEqual([
      ETurnEntry.Start,
      ETurnEntry.Resume,
    ])
  })

  it('names on the turn span why the turn failed', async () => {
    const trace = new RecordingTracer()
    const { runner } = rigOf({
      script: [{ text: 'never reached' }],
      overrides: {
        trace,
        model: {
          identity: { id: 'scripted', modelId: 'scripted-1' },
          step: async () => {
            throw new ModelStreamError({ message: 'connection reset' })
          },
        },
      },
    })

    const outcome = await runner.say({ threadId: THREAD, text: 'go' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    const [turn] = trace.named(ESpan.Turn)
    expect(turn?.fields).toMatchObject({
      status: ETurnStatus.Failed,
      failureKind: ERunFailureKind.Network,
    })
  })

  it('writes first_token_ms on the turn span once, from the prompt post time', async () => {
    const trace = new RecordingTracer()
    const firstToken = new FirstTokenClock(() => 1500)
    const chunks: Chunk[] = [
      { type: 'text-delta', id: 't', text: 'a' },
      { type: 'text-delta', id: 't', text: 'b' },
    ]
    const model = new TracedModel({
      trace,
      firstToken,
      inner: {
        identity: { id: 'p', modelId: 'm' },
        step: async ({ onChunk }) => {
          for (const chunk of chunks) onChunk?.(chunk)
          return { parts: [], toolCalls: [], finishReason: EFinishReason.Stop }
        },
      },
    })
    const record = {
      ownEvents: async () => [
        {
          type: 'user-said',
          at: '1970-01-01T00:00:00.000Z',
          id: 'evt-1',
          seq: 1,
          threadId: THREAD,
          runId: 'run-1',
          depth: 0,
        },
      ],
    } as unknown as AgentRecordPort

    await traceTurn({
      trace,
      model,
      record,
      threadId: THREAD,
      entry: ETurnEntry.Start,
      firstToken,
      run: async () => {
        await model.step({
          assembled: { system: [], messages: [] },
          tools: [],
          signal: new AbortController().signal,
        })
        return { status: ETurnStatus.Completed, runId: toRunId('run-1') }
      },
    })

    const [turn] = trace.named(ESpan.Turn)
    expect(turn?.fields.firstTokenMs).toBe(1500)
    expect(turn?.fields.queuedMs).toBeGreaterThanOrEqual(0)
    expect(trace.named(ESpan.ModelCall)[0]?.marks).toContain(ESpanMark.FirstChunk)
  })

  it('records nothing and changes nothing when no tracer is wired', async () => {
    const { runner } = rigOf({ script: [{ text: 'hi' }] })
    const outcome = await runner.say({ threadId: THREAD, text: 'go' })
    expect(outcome.status).toBe(ETurnStatus.Completed)
  })
})

describe('TracedModel', () => {
  it('marks first chunk, reasoning and output once each and keeps the caller filter', async () => {
    const trace = new RecordingTracer()
    const seen: string[] = []
    const model = new TracedModel({
      trace,
      inner: {
        identity: { id: 'p', modelId: 'm' },
        step: async ({ onChunk }) => {
          const chunks: Chunk[] = [
            { type: 'reasoning-delta', id: 'r', text: 'x' },
            { type: 'text-delta', id: 't', text: 'a' },
            { type: 'text-delta', id: 't', text: 'b' },
          ]
          for (const chunk of chunks) onChunk?.(chunk)
          return { parts: [], toolCalls: [], finishReason: EFinishReason.Stop, ranFast: true }
        },
      },
    })

    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () =>
        model.step({
          assembled: { system: [], messages: [] },
          tools: [],
          signal: new AbortController().signal,
          onChunk: (chunk) => {
            seen.push(chunk.type)
            return chunk
          },
        }),
    })

    const [call] = trace.named(ESpan.ModelCall)
    expect(call?.marks).toEqual([
      ESpanMark.FirstChunk,
      ESpanMark.FirstReasoning,
      ESpanMark.FirstOutput,
    ])
    expect(seen).toEqual(['reasoning-delta', 'text-delta', 'text-delta'])
    expect(call?.fields.speed).toBe(ESpanSpeed.Fast)
  })
})
