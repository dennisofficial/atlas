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

const STREAM = sse([
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'hi from gateway' },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
  },
])

describe('gateway provider model', () => {
  it('posts the key to the gateway language-model endpoint and parses the stream', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const credentials = new FakeCredentials([apiKey('gw-key')])
    const model = createProviderModel({
      ref: { providerId: 'gateway', modelId: 'openai/gpt-5.1' },
      credentials,
      effort: () => EEffort.Medium,
      fetch: http.fetch,
    })

    expect(textOf(await drain((await model.doStream(CALL_OPTIONS)).stream))).toBe('hi from gateway')

    const [request] = http.requests
    expect(request?.url).toContain('ai-gateway.vercel.sh')
    expect(request?.url).toEndWith('/language-model')
    expect(request?.headers.authorization).toBe('Bearer gw-key')
    expect(request?.headers['ai-language-model-id']).toBe('openai/gpt-5.1')
    expect(request?.body).toMatchObject({ providerOptions: { gateway: { caching: 'auto' } } })
    expect(credentials.reads[0]?.provider).toBe(EAuthProvider.Gateway)
  })
})
