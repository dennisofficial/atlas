import { describe, expect, it } from 'bun:test'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

import type { ProviderIdentity, ProviderPrompt } from '@dltech/atlas-core'

import { simulateReadableStream } from 'ai/test'

import { runModelStream, type StreamTimeout } from '../ai-sdk-model-port'
import { StreamStallError } from '../errors'
import { modelFailureOf } from '../failure'
import { providerPartsFor, scriptedModel } from '../testing/scripted-model'

const identity: ProviderIdentity = { id: 'anthropic', modelId: 'claude-opus-5' }

const prompt: ProviderPrompt = {
  instructions: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  provider: identity,
}

const IMPATIENT: StreamTimeout = { ttfbMs: 5_000, firstChunkMs: 25, chunkMs: 25 }
const PATIENT: StreamTimeout = { ttfbMs: 5_000, firstChunkMs: 5_000, chunkMs: 5_000 }
const UNANSWERED: StreamTimeout = { ttfbMs: 25, firstChunkMs: 5_000, chunkMs: 5_000 }

// Enqueues its parts and then stays open without ever closing — the polite silent connection no
// layer used to time out. Errors the stream when the SDK aborts the request, the way a real
// provider's fetch rejects when its signal fires.
const stallingModel = (parts: LanguageModelV4StreamPart[]): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason))
        },
      }),
    }),
  })

const runStalled = (args: { parts: LanguageModelV4StreamPart[]; streamTimeout: StreamTimeout }) =>
  runModelStream({
    model: stallingModel(args.parts),
    prompt,
    tools: [],
    signal: new AbortController().signal,
    streamTimeout: args.streamTimeout,
  })

const midStreamSilence: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 'stalled-text' },
  { type: 'text-delta', id: 'stalled-text', delta: 'half a thought' },
]

describe('a stream that goes silent without closing', () => {
  it('rejects when the first chunk never arrives', async () => {
    await expect(runStalled({ parts: [], streamTimeout: IMPATIENT })).rejects.toThrow(
      StreamStallError,
    )
  })

  it('rejects when chunks stop arriving mid-stream', async () => {
    await expect(
      runStalled({ parts: midStreamSilence, streamTimeout: IMPATIENT }),
    ).rejects.toThrow(StreamStallError)
  })

  it('classifies the rejection as a retryable dropped connection', async () => {
    const error = await runStalled({ parts: midStreamSilence, streamTimeout: IMPATIENT }).catch(
      (caught: unknown) => caught,
    )

    expect(modelFailureOf(error)).toEqual({})
  })

  it('lets a healthy stream through when the timeout is never hit', async () => {
    const result = await runModelStream({
      model: scriptedModel({ script: [{ text: 'all present' }] }),
      prompt,
      tools: [],
      signal: new AbortController().signal,
      streamTimeout: PATIENT,
    })

    expect(result.parts).toEqual([{ type: 'text', text: 'all present' }])
  })

  it('still returns the partial step when the caller aborted, not the timeout', async () => {
    const controller = new AbortController()

    const result = await runModelStream({
      model: stallingModel(midStreamSilence),
      prompt,
      tools: [],
      signal: controller.signal,
      streamTimeout: PATIENT,
      onChunk: (chunk) => {
        if (chunk.type === 'text-delta') controller.abort()
        return chunk
      },
    })

    expect(result.parts).toEqual([{ type: 'text', text: 'half a thought' }])
  })
})

// A provider that accepts the request and never answers it: doStream itself never settles, the
// way inference.net behaves when its queue is congested (diagnosed 2026-09-15 from live
// harness.db turns whose first model call sat silent for 3-50 minutes).
const unansweringModel = (onAborted?: () => void): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doStream: ({ abortSignal }) =>
      new Promise(() => {
        abortSignal?.addEventListener('abort', () => onAborted?.())
      }),
  })

const runUnanswered = (args: { model: MockLanguageModelV4; streamTimeout: StreamTimeout }) =>
  runModelStream({
    model: args.model,
    prompt,
    tools: [],
    signal: new AbortController().signal,
    streamTimeout: args.streamTimeout,
  })

describe('a provider that never answers the request', () => {
  it('rejects once the time-to-headers budget is spent', async () => {
    await expect(
      runUnanswered({ model: unansweringModel(), streamTimeout: UNANSWERED }),
    ).rejects.toThrow(StreamStallError)
  })

  it('classifies the rejection as a retryable dropped connection', async () => {
    const error = await runUnanswered({
      model: unansweringModel(),
      streamTimeout: UNANSWERED,
    }).catch((caught: unknown) => caught)

    expect(modelFailureOf(error)).toEqual({})
  })

  it('aborts the request it gave up on, so the socket does not linger', async () => {
    let aborted = false

    await runUnanswered({
      model: unansweringModel(() => {
        aborted = true
      }),
      streamTimeout: UNANSWERED,
    }).catch(() => {})

    expect(aborted).toBe(true)
  })

  it('lets a slow provider through when it answers inside the budget', async () => {
    const slowModel = new MockLanguageModelV4({
      doStream: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return {
          stream: simulateReadableStream<LanguageModelV4StreamPart>({
            chunks: providerPartsFor({ text: 'late but here' }),
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
        }
      },
    })

    const result = await runUnanswered({ model: slowModel, streamTimeout: PATIENT })

    expect(result.parts).toEqual([{ type: 'text', text: 'late but here' }])
  })
})
