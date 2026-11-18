import { describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider, EEffort, toAccountId } from '@dltech/atlas-core'

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
  {
    type: 'message_start',
    message: { id: 'm1', model: 'claude-sonnet-4-6', usage: { input_tokens: 3, output_tokens: 0 } },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi from claude' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
  { type: 'message_stop' },
])

const REF = { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }

describe('anthropic provider model', () => {
  it('sends an api key as x-api-key with the chosen effort and parses the stream', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const credentials = new FakeCredentials([apiKey('sk-ant-1')])
    const model = createProviderModel({
      ref: REF,
      credentials,
      effort: () => EEffort.High,
      fetch: http.fetch,
    })

    const { stream } = await model.doStream(CALL_OPTIONS)
    expect(textOf(await drain(stream))).toBe('hi from claude')

    const [request] = http.requests
    expect(request?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request?.headers['x-api-key']).toBe('sk-ant-1')
    expect(request?.body).toMatchObject({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    })
    expect(credentials.reads[0]?.provider).toBe(EAuthProvider.Anthropic)
  })

  it('sends a budget for cards that take one', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const model = createProviderModel({
      ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      credentials: new FakeCredentials([apiKey('k')]),
      effort: () => EEffort.Low,
      fetch: http.fetch,
    })
    await drain((await model.doStream(CALL_OPTIONS)).stream)
    expect(http.requests[0]?.body).toMatchObject({ thinking: { type: 'enabled' } })
  })

  it('sends an oauth token as a bearer with the oauth beta', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const model = createProviderModel({
      ref: REF,
      credentials: new FakeCredentials([
        {
          kind: EAuthKind.Oauth,
          accountId: toAccountId('acct-1'),
          accessToken: 'oat-1',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      ]),
      effort: () => EEffort.Medium,
      fetch: http.fetch,
    })
    await drain((await model.doStream(CALL_OPTIONS)).stream)

    expect(http.requests[0]?.headers.authorization).toBe('Bearer oat-1')
    expect(http.requests[0]?.headers['anthropic-beta']).toContain('oauth-2025-04-20')
    expect(http.requests[0]?.headers['x-api-key']).toBeUndefined()
  })

  it('discards a refused credential and retries once with the fresh one', async () => {
    const http = fakeFetch([
      {
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }),
      },
      { body: STREAM },
    ])
    const credentials = new FakeCredentials([apiKey('stale'), apiKey('fresh')])
    const model = createProviderModel({
      ref: REF,
      credentials,
      effort: () => EEffort.Medium,
      fetch: http.fetch,
    })

    expect(textOf(await drain((await model.doStream(CALL_OPTIONS)).stream))).toBe('hi from claude')
    expect(credentials.discarded).toHaveLength(1)
    expect(http.requests.map((request) => request.headers['x-api-key'])).toEqual(['stale', 'fresh'])
  })
})
