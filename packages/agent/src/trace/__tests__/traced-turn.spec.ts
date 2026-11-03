import { describe, expect, it } from 'bun:test'

import { EFinishReason, type Chunk } from '@dltech/atlas-core'
import { ESpan, ESpanMark, ESpanOutcome } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { THREAD, rigOf } from '../../__tests__/exit-fixture'
import { HookChain } from '../../hooks/registry'
import { FakeTool, fakeToolRegistry } from '../../testing'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { ETurnStatus } from '../../loop/turn-outcome'
import { TracedModel } from '../traced-model'

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
    })

    const calls = trace.named(ESpan.ModelCall)
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.parent === turn)).toBe(true)
    expect(calls[0]?.fields.toolCalls).toBe(1)

    const [toolSpan] = trace.named(ESpan.Tool)
    expect(toolSpan?.fields).toMatchObject({ tool: 'read', callId: 'c1', outcome: ESpanOutcome.Ok })
    const [invoke] = trace.named(ESpan.ToolInvoke)
    expect(invoke?.parent).toBe(toolSpan)
    expect(trace.named(ESpan.ToolHooks)[0]?.parent).toBe(toolSpan)

    expect(trace.named(ESpan.ContextPrepare).length).toBeGreaterThanOrEqual(2)
    expect(trace.named(ESpan.RecordAppend).length).toBeGreaterThan(0)
    expect(trace.spans.every((span) => span.ended)).toBe(true)
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
          return { parts: [], toolCalls: [], finishReason: EFinishReason.Stop }
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
  })
})
