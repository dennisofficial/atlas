import { describe, expect, it } from 'bun:test'

import { EAuthProvider, EEffort } from '@dltech/atlas-core'

import { createProviderModel } from '..'
import {
  apiKey,
  CALL_OPTIONS,
  drain,
  fakeFetch,
  FakeCredentials,
  sse,
  textOf,
} from './provider-fixtures'

const CHUNKS = sse([
  {
    id: 'c1',
    created: 1,
    model: 'm',
    choices: [
      { index: 0, delta: { role: 'assistant', content: 'hi from chat' }, finish_reason: null },
    ],
  },
  {
    id: 'c1',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
  },
]).concat('data: [DONE]\n\n')

describe.each([
  {
    providerId: 'openrouter',
    modelId: 'openai/gpt-5.1',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    authProvider: EAuthProvider.OpenRouter,
  },
  {
    providerId: 'inference',
    modelId: 'meta-llama/llama-3.1-8b-instruct',
    url: 'https://api.inference.net/v1/chat/completions',
    authProvider: EAuthProvider.Inference,
  },
])('$providerId provider model', ({ providerId, modelId, url, authProvider }) => {
  const build = (fetch: typeof globalThis.fetch, credentials: FakeCredentials) =>
    createProviderModel({
      ref: { providerId, modelId },
      credentials,
      effort: () => EEffort.Medium,
      fetch,
    })

  it('posts a bearer key to the chat completions endpoint and parses the stream', async () => {
    const http = fakeFetch([{ body: CHUNKS }])
    const credentials = new FakeCredentials([apiKey('key-1')])

    const { stream } = await build(http.fetch, credentials).doStream(CALL_OPTIONS)
    expect(textOf(await drain(stream))).toBe('hi from chat')

    expect(http.requests[0]?.url).toBe(url)
    expect(http.requests[0]?.headers.authorization).toBe('Bearer key-1')
    expect(credentials.reads[0]?.provider).toBe(authProvider)
  })

  it('reads the credential per request', async () => {
    const http = fakeFetch([{ body: CHUNKS }])
    const credentials = new FakeCredentials([apiKey('key-1')])
    const model = build(http.fetch, credentials)

    expect(credentials.reads).toHaveLength(0)
    await drain((await model.doStream(CALL_OPTIONS)).stream)
    await drain((await model.doStream(CALL_OPTIONS)).stream)
    expect(credentials.reads).toHaveLength(2)
  })

  it('carries the effort rung as reasoning_effort when the model has a card', async () => {
    const http = fakeFetch([{ body: CHUNKS }])
    const model = createProviderModel({
      ref: { providerId, modelId },
      credentials: new FakeCredentials([apiKey('k')]),
      effort: () => EEffort.High,
      fetch: http.fetch,
    })
    await drain(
      (
        await model.doStream({
          ...CALL_OPTIONS,
          providerOptions: { [providerId]: { reasoningEffort: 'low' } },
        })
      ).stream,
    )
    expect(http.requests[0]?.body).toMatchObject({ reasoning_effort: 'low' })
  })
})

describe('openrouter attribution', () => {
  it('names the app in request headers', async () => {
    const http = fakeFetch([{ body: CHUNKS }])
    const model = createProviderModel({
      ref: { providerId: 'openrouter', modelId: 'x/y' },
      credentials: new FakeCredentials([apiKey('k')]),
      effort: () => EEffort.Medium,
      fetch: http.fetch,
    })
    await drain((await model.doStream(CALL_OPTIONS)).stream)
    expect(http.requests[0]?.headers['x-title']).toBe('Atlas')
  })
})
