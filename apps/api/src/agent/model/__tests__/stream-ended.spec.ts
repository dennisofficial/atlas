import { describe, expect, it } from 'bun:test'

import { MockLanguageModelV4 } from 'ai/test'
import { InvalidResponseDataError } from 'ai'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'

import { EProviderFailureKind, type ProviderPrompt } from '@dltech/atlas-core'

import { runModelStream } from '../ai-sdk-model-port'
import { StreamEndedWithoutFinish } from '../stream-ended-without-finish'
import { never, normalized, transient } from './normalize-fixture'

const prompt: ProviderPrompt = {
  instructions: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  provider: { id: 'mock', modelId: 'mock-model' },
}

const FINISH: LanguageModelV4StreamPart = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
}

const TEXT: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'partial' },
  { type: 'text-end', id: 't' },
]

const modelStreaming = (parts: LanguageModelV4StreamPart[]) =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      }),
    }),
  })

const runFailure = async (parts: LanguageModelV4StreamPart[]): Promise<unknown> => {
  try {
    await runModelStream({
      model: modelStreaming(parts),
      prompt,
      tools: [],
      signal: new AbortController().signal,
    })
  } catch (error) {
    return error
  }
  throw new Error('the stream was expected to fail')
}

describe('a model stream that ends without a finish part', () => {
  it('completes when the finish part arrives', async () => {
    const result = await runModelStream({
      model: modelStreaming([...TEXT, FINISH]),
      prompt,
      tools: [],
      signal: new AbortController().signal,
    })

    expect(result.parts.length).toBeGreaterThan(0)
  })

  it('fails with the typed error, retryable as a network failure', async () => {
    const error = await runFailure(TEXT)

    expect(error).toBeInstanceOf(StreamEndedWithoutFinish)
    expect(normalized(error)).toMatchObject(transient(EProviderFailureKind.Network))
  })

  it('does not fail a stream the caller aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await runModelStream({
      model: modelStreaming(TEXT),
      prompt,
      tools: [],
      signal: controller.signal,
    })
  })

  it('reads the openai-compatible truncation report as the same typed error', async () => {
    const error = await runFailure([
      ...TEXT,
      {
        type: 'error',
        error: new InvalidResponseDataError({
          data: undefined,
          message: 'Response stream ended without a finish reason.',
        }),
      },
      FINISH,
    ])

    expect(error).toBeInstanceOf(StreamEndedWithoutFinish)
    expect(normalized(error)).toMatchObject(transient(EProviderFailureKind.Network))
  })

  it('refuses invalid response data that is not a truncated stream', async () => {
    const error = await runFailure([
      ...TEXT,
      {
        type: 'error',
        error: new InvalidResponseDataError({ data: {}, message: "Expected 'id' to be a string." }),
      },
    ])

    expect(error).not.toBeInstanceOf(StreamEndedWithoutFinish)
    expect(normalized(error)).toMatchObject(never(EProviderFailureKind.Other))
  })
})
