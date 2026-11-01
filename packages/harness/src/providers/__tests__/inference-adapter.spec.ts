import { describe, expect, it } from 'bun:test'
import { generateText } from 'ai'

import {
  EEffort,
  EImageTier,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  type CredentialPort,
  type ModelCard,
} from '@dltech/atlas-core'

import { apiKeyCredential } from '../../credentials/testing'
import { InferenceAdapter, INFERENCE_PROVIDER_ID } from '../inference-adapter'
import { recordingFetch, refusingFirstFetch } from './recording-fetch'

const RESPONSE_JSON = JSON.stringify({
  id: 'chatcmpl_stub',
  object: 'chat.completion',
  created: 1_767_225_600,
  model: 'kimi-k3-fast',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'pong' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
})

const credentials: CredentialPort = {
  read: async () => apiKeyCredential({ apiKey: 'sk-test' }),
  discard: async () => undefined,
}

describe('inference supportedUrls', () => {
  it('defers to the model the provider builds rather than freezing an empty map', async () => {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    const adapter = new InferenceAdapter({ credentials, cards: [card] })

    const declared = createOpenAICompatible({
      name: INFERENCE_PROVIDER_ID,
      baseURL: 'https://api.inference.net/v1',
      supportsStructuredOutputs: true,
    }).chatModel(card.ref.modelId).supportedUrls

    expect(adapter.model({ card, effort: () => EEffort.Medium }).supportedUrls).toEqual(declared)
  })
})

const card: ModelCard = {
  ref: { providerId: INFERENCE_PROVIDER_ID, modelId: 'kimi-k3-fast' },
  label: 'kimi-k3-fast',
  api: 'openai-completions',
  contextWindow: 1_048_576,
  imageTier: EImageTier.Standard,
  effort: { [EEffort.Low]: 'low', [EEffort.High]: 'high' },
}

describe('the inference adapter merging provider options', () => {
  it('keeps the request cache key alongside the effort rung instead of clobbering it', async () => {
    const recorder = recordingFetch({ body: RESPONSE_JSON, contentType: 'application/json' })
    const adapter = new InferenceAdapter({ credentials, cards: [card], fetch: recorder.fetch })
    const model = adapter.model({ card, effort: () => EEffort.High })

    await generateText({
      model,
      prompt: 'ping',
      providerOptions: { [INFERENCE_PROVIDER_ID]: { prompt_cache_key: 'thread-1' } },
    })

    expect(recorder.requests[0]?.body).toMatchObject({
      reasoning_effort: 'high',
      prompt_cache_key: 'thread-1',
    })
  })

  it('forwards the request cache key even for a model with no effort rungs', async () => {
    const { effort: _effort, ...silent } = card
    const recorder = recordingFetch({ body: RESPONSE_JSON, contentType: 'application/json' })
    const adapter = new InferenceAdapter({ credentials, cards: [silent], fetch: recorder.fetch })
    const model = adapter.model({ card: silent, effort: () => EEffort.High })

    await generateText({
      model,
      prompt: 'ping',
      providerOptions: { [INFERENCE_PROVIDER_ID]: { prompt_cache_key: 'thread-1' } },
    })

    expect(recorder.requests[0]?.body).toMatchObject({ prompt_cache_key: 'thread-1' })
    expect(recorder.requests[0]?.body).not.toHaveProperty('reasoning_effort')
  })
})

describe('the inference adapter tagging a failure with its account', () => {
  it('names the account resolved at request time on a 401', async () => {
    const { toAccountId } = await import('@dltech/atlas-core')
    const { failureAccountOf } = await import('../failure-account')
    const { normalizeProviderFailure } = await import('../../model/failure')
    const recorder = refusingFirstFetch({
      body: RESPONSE_JSON,
      refusalBody: '{"error":{"message":"Invalid API key","code":"invalid_api_key"}}',
    })
    const adapter = new InferenceAdapter({
      credentials: {
        read: async () => apiKeyCredential({ apiKey: 'sk-test', accountId: toAccountId('acct-9') }),
        discard: async () => undefined,
      },
      cards: [card],
      fetch: recorder.fetch,
    })
    const model = adapter.model({ card, effort: () => EEffort.High })

    const error = await generateText({ model, prompt: 'ping', maxRetries: 0 }).catch(
      (caught: unknown) => caught,
    )

    expect(failureAccountOf(error)).toBe(toAccountId('acct-9'))
    expect(normalizeProviderFailure({ cause: error, nowMs: 0 })).toMatchObject({
      kind: EProviderFailureKind.Auth,
      scope: EProviderFailureScope.Credential,
      retry: EProviderRetry.Never,
      statusCode: 401,
      accountId: toAccountId('acct-9'),
      providerId: 'inference',
      modelId: 'kimi-k3-fast',
    })
  })
})

describe('the inference adapter separating a missing header from a rejected key', () => {
  const adapterFor = (fetch: ReturnType<typeof refusingFirstFetch>['fetch']) =>
    new InferenceAdapter({ credentials, cards: [card], fetch })

  const failureOf = async (refusalBody: string, status = 401) => {
    const { normalizeProviderFailure } = await import('../../model/failure')
    const recorder = refusingFirstFetch({ body: RESPONSE_JSON, refusalBody, status })
    const model = adapterFor(recorder.fetch).model({ card, effort: () => EEffort.High })
    const error = await generateText({ model, prompt: 'ping', maxRetries: 0 }).catch(
      (caught: unknown) => caught,
    )
    return { failure: normalizeProviderFailure({ cause: error, nowMs: 0 }), recorder }
  }

  it('reports Delivery when the provider says the Authentication header was missing', async () => {
    const { failure, recorder } = await failureOf(
      '{"error":{"message":"Missing Authentication header","code":"invalid_api_key"}}',
    )

    expect(failure.kind).toBe(EProviderFailureKind.Delivery)
    expect(recorder.requests).toHaveLength(1)
  })

  it('reports Auth when the key was delivered and rejected', async () => {
    const { failure } = await failureOf('{"error":{"message":"bad","code":"invalid_api_key"}}')

    expect(failure.kind).toBe(EProviderFailureKind.Auth)
  })

  it('reports a bare delivered 401 as Auth, since the adapter built the header', async () => {
    const { failure } = await failureOf('{"error":{"message":"nope"}}')

    expect(failure.kind).toBe(EProviderFailureKind.Auth)
  })

  it('reports a delivered 403 as a route denial, not a bad key', async () => {
    const { failure } = await failureOf('{"error":{"message":"forbidden"}}', 403)

    expect(failure).toMatchObject({
      kind: EProviderFailureKind.ModelDenied,
      scope: EProviderFailureScope.Route,
    })
  })

  it('reports a monthly-spend style quota code as Quota on a delivered key', async () => {
    const { failure } = await failureOf(
      '{"error":{"message":"You exceeded your quota","code":"insufficient_quota"}}',
      429,
    )

    expect(failure).toMatchObject({
      kind: EProviderFailureKind.Quota,
      scope: EProviderFailureScope.Credential,
      retry: EProviderRetry.Never,
    })
  })

  it('tags an SSE error chunk with the request provenance', async () => {
    const { normalizeProviderFailure } = await import('../../model/failure')
    const { streamText } = await import('ai')
    const sse = `data: ${JSON.stringify({ error: { message: 'out of credit', code: 'insufficient_quota' } })}\n\n`
    const recorder = recordingFetch({ body: sse })
    const model = adapterFor(recorder.fetch).model({ card, effort: () => EEffort.High })

    const result = streamText({ model, prompt: 'ping', maxRetries: 0, onError: () => undefined })
    let streamError: unknown
    for await (const part of result.fullStream) {
      if (part.type === 'error') streamError = part.error
    }

    expect(normalizeProviderFailure({ cause: streamError, nowMs: 0 })).toMatchObject({
      kind: EProviderFailureKind.Quota,
      scope: EProviderFailureScope.Credential,
      providerId: 'inference',
    })
  })
})
