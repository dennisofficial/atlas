import { describe, expect, it } from 'bun:test'

import { APICallError, type LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

import type { Assembled, MediaRef } from '@dltech/atlas-core'

import type { MediaUrlSource } from '../../media/media-urls'
import { AiSdkModelPort } from '../ai-sdk-model-port'

const refOf = (letter: string): MediaRef => ({
  hash: letter.repeat(64),
  mediaType: 'image/png',
  size: 10,
  width: 4,
  height: 4,
})

const kept = refOf('a')
const gone = refOf('b')

const assembled: Assembled = {
  system: [],
  messages: [
    {
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'compare these' },
          { type: 'media', media: kept, source: 'kept.png' },
          { type: 'media', media: gone, source: 'gone.png' },
        ],
      },
      origin: { sessionId: 's', seq: 1 } as never,
    },
  ],
}

const ANSWER: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'done' },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  },
]

const downloadRefusal = () =>
  new APICallError({
    message: 'Bad Request',
    url: 'https://provider.test/v1',
    requestBodyValues: {},
    statusCode: 400,
    responseBody: JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Unable to download the file.' },
    }),
    isRetryable: false,
  })

const overloaded = () =>
  new APICallError({
    message: 'Overloaded',
    url: 'https://provider.test/v1',
    requestBodyValues: {},
    statusCode: 529,
    responseBody: JSON.stringify({ type: 'error', error: { type: 'overloaded_error' } }),
    isRetryable: true,
  })

const answering = () =>
  new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of ANSWER) controller.enqueue(part)
      controller.close()
    },
  })

const modelFailingFirst = (failure: () => Error, failures = 1) => {
  let calls = 0
  return new MockLanguageModelV4({
    supportedUrls: { 'image/*': [/^https:\/\//] },
    doStream: async () => {
      calls += 1
      if (calls <= failures) throw failure()
      return { stream: answering() }
    },
  })
}

const sourceMissing = (missing: readonly string[]) => {
  const asked = { urls: [] as string[][], missing: [] as string[][] }
  const source: MediaUrlSource = {
    urlsFor: async (hashes) => {
      asked.urls.push([...hashes])
      return new Map(hashes.map((hash) => [hash, `https://blob.fake/${hash.slice(0, 1)}`]))
    },
    missingOf: async (hashes) => {
      asked.missing.push([...hashes])
      return hashes.filter((hash) => missing.includes(hash))
    },
  }
  return { source, asked }
}

const step = (port: AiSdkModelPort) =>
  port.step({ assembled, tools: [], signal: new AbortController().signal })

const userContent = (model: MockLanguageModelV4, call: number) =>
  (model.doStreamCalls[call]?.prompt ?? []).flatMap((message) =>
    message.role === 'user' ? message.content : [],
  )

const identity = { id: 'mock', modelId: 'mock-model' }

describe('AiSdkModelPort missing media', () => {
  it('drops a vanished image, names it to the model and retries once', async () => {
    const model = modelFailingFirst(downloadRefusal)
    const { source, asked } = sourceMissing([gone.hash])
    const port = new AiSdkModelPort({ model, identity, mediaUrls: source })

    await step(port)

    expect(model.doStreamCalls).toHaveLength(2)
    expect(asked.missing).toEqual([[kept.hash, gone.hash]])
    const retried = userContent(model, 1)
    expect(retried.filter((part) => part.type === 'file')).toHaveLength(1)
    expect(retried).toContainEqual({ type: 'text', text: '[image unavailable: gone.png]' })
  })

  it('remembers the vanished image so the next step neither signs nor sends it', async () => {
    const model = modelFailingFirst(downloadRefusal)
    const { source, asked } = sourceMissing([gone.hash])
    const port = new AiSdkModelPort({ model, identity, mediaUrls: source })

    await step(port)
    await step(port)

    expect(model.doStreamCalls).toHaveLength(3)
    expect(asked.urls.at(-1)).toEqual([kept.hash])
    expect(userContent(model, 2)).toContainEqual({
      type: 'text',
      text: '[image unavailable: gone.png]',
    })
  })

  it('rethrows the refusal when every image is still in the store', async () => {
    const model = modelFailingFirst(downloadRefusal)
    const { source } = sourceMissing([])
    const port = new AiSdkModelPort({ model, identity, mediaUrls: source })

    await expect(step(port)).rejects.toThrow()
    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('leaves other failures to the retry policy', async () => {
    const model = modelFailingFirst(overloaded)
    const { source, asked } = sourceMissing([gone.hash])
    const port = new AiSdkModelPort({ model, identity, mediaUrls: source })

    await expect(step(port)).rejects.toThrow()
    expect(asked.missing).toEqual([])
  })

  it('retries only once when the retry is refused again', async () => {
    const model = modelFailingFirst(downloadRefusal, 2)
    const { source } = sourceMissing([gone.hash])
    const port = new AiSdkModelPort({ model, identity, mediaUrls: source })

    await expect(step(port)).rejects.toThrow()
    expect(model.doStreamCalls).toHaveLength(2)
  })
})
