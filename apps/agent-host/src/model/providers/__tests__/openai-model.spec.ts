import { describe, expect, it } from 'bun:test'

import { EAuthKind, EEffort, toAccountId, type Credential } from '@dltech/atlas-core'

import { CredentialError } from '../../credential-error'
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

const RESPONSE = { id: 'r1', created_at: 1, model: 'gpt-5.1' }
const STREAM = sse([
  { type: 'response.created', response: RESPONSE },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'message', id: 'msg1', role: 'assistant', status: 'in_progress', content: [] },
  },
  {
    type: 'response.output_text.delta',
    item_id: 'msg1',
    output_index: 0,
    content_index: 0,
    delta: 'hi from gpt',
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'message',
      id: 'msg1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hi from gpt', annotations: [] }],
    },
  },
  {
    type: 'response.completed',
    response: {
      ...RESPONSE,
      status: 'completed',
      output: [],
      usage: { input_tokens: 3, output_tokens: 3, total_tokens: 6 },
    },
  },
])

const REF = { providerId: 'openai', modelId: 'gpt-5.1' }

const oauth = (providerAccountId?: string): Credential => ({
  kind: EAuthKind.Oauth,
  accountId: toAccountId('acct-1'),
  accessToken: 'chatgpt-token',
  expiresAt: '2099-01-01T00:00:00Z',
  ...(providerAccountId === undefined ? {} : { providerAccountId }),
})

describe('openai provider model', () => {
  it('posts an api key to api.openai.com responses with the chosen reasoning effort', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const model = createProviderModel({
      ref: REF,
      credentials: new FakeCredentials([apiKey('sk-1')]),
      effort: () => EEffort.High,
      fetch: http.fetch,
    })

    expect(textOf(await drain((await model.doStream(CALL_OPTIONS)).stream))).toBe('hi from gpt')

    const [request] = http.requests
    expect(request?.url).toBe('https://api.openai.com/v1/responses')
    expect(request?.headers.authorization).toBe('Bearer sk-1')
    expect(request?.headers['chatgpt-account-id']).toBeUndefined()
    expect(request?.body).toMatchObject({ reasoning: { effort: 'high' } })
  })

  it('posts a chatgpt login to the codex backend with codex headers and store off', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const model = createProviderModel({
      ref: REF,
      credentials: new FakeCredentials([oauth('chatgpt-acct')]),
      effort: () => EEffort.Medium,
      fetch: http.fetch,
    })

    expect(textOf(await drain((await model.doStream(CALL_OPTIONS)).stream))).toBe('hi from gpt')

    const [request] = http.requests
    expect(request?.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer chatgpt-token',
      'chatgpt-account-id': 'chatgpt-acct',
      'openai-beta': 'responses=experimental',
      originator: 'codex_cli_rs',
    })
    expect(request?.body).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] })
  })

  it('collects a codex generation from the stream', async () => {
    const http = fakeFetch([{ body: STREAM }])
    const model = createProviderModel({
      ref: REF,
      credentials: new FakeCredentials([oauth('chatgpt-acct')]),
      effort: () => EEffort.Medium,
      fetch: http.fetch,
    })

    const result = await model.doGenerate(CALL_OPTIONS)
    expect(result.content).toMatchObject([{ type: 'text', text: 'hi from gpt' }])
    expect(http.requests[0]?.body).toMatchObject({ stream: true })
  })

  it('fetches https images itself only for the provider, not the host', () => {
    const model = createProviderModel({
      ref: REF,
      credentials: new FakeCredentials([apiKey('k')]),
      effort: () => EEffort.Medium,
    })
    const patterns = (model.supportedUrls as Record<string, RegExp[]>)['image/*']
    expect(patterns?.some((pattern) => pattern.test('https://x.test/a.png'))).toBe(true)
    expect(patterns?.some((pattern) => pattern.test('http://x.test/a.png'))).toBe(false)
  })

  it('refuses a codex login with no chatgpt account id', async () => {
    const model = createProviderModel({
      ref: REF,
      credentials: new FakeCredentials([oauth()]),
      effort: () => EEffort.Medium,
      fetch: fakeFetch([{ body: STREAM }]).fetch,
    })
    await expect(model.doStream(CALL_OPTIONS)).rejects.toBeInstanceOf(CredentialError)
  })
})
