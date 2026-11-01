import { describe, expect, it } from 'bun:test'

import { EProviderFailureKind, EProviderRetry, type CredentialPort } from '@dltech/atlas-core'

import { apiKeyCredential, oauthCredential } from '../../credentials/testing'
import { normalizeProviderFailure } from '../../model/failure'
import { createAnthropicOauthModel } from '../anthropic-oauth'
import { createOpenAiModel } from '../openai-oauth'
import { recordingFetch } from './recording-fetch'

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }]

const holding = (read: CredentialPort['read']): CredentialPort => ({
  read,
  discard: async () => undefined,
})

const failureOf = async (call: () => PromiseLike<unknown>) => {
  const thrown = await Promise.resolve(call()).then(
    () => undefined,
    (error: unknown) => error,
  )
  return normalizeProviderFailure({ cause: thrown, nowMs: 0 })
}

describe('an empty resolved key', () => {
  it('is Delivery on the Anthropic path, with no request sent', async () => {
    const recorder = recordingFetch({ body: '' })
    const model = createAnthropicOauthModel({
      credentials: holding(async () => apiKeyCredential({ apiKey: '' })),
      modelId: 'claude-opus-5',
      fetch: recorder.fetch,
    })

    const failure = await failureOf(() => model.doStream({ prompt: PROMPT }))

    expect(failure).toMatchObject({
      kind: EProviderFailureKind.Delivery,
      retry: EProviderRetry.Never,
    })
    expect(failure.accountId).toBeDefined()
    expect(recorder.requests).toHaveLength(0)
  })

  it('is Delivery for an empty Anthropic subscription token', async () => {
    const model = createAnthropicOauthModel({
      credentials: holding(async () => oauthCredential({ accessToken: '' })),
      modelId: 'claude-opus-5',
      fetch: recordingFetch({ body: '' }).fetch,
    })

    expect((await failureOf(() => model.doStream({ prompt: PROMPT }))).kind).toBe(
      EProviderFailureKind.Delivery,
    )
  })

  it('is Delivery on the OpenAI path, with no request sent', async () => {
    const recorder = recordingFetch({ body: '' })
    const model = createOpenAiModel({
      credentials: holding(async () => apiKeyCredential({ apiKey: '' })),
      providerId: 'openai',
      modelId: 'gpt-5.3-codex',
      fetch: recorder.fetch,
    })

    const failure = await failureOf(() => model.doStream({ prompt: PROMPT }))

    expect(failure.kind).toBe(EProviderFailureKind.Delivery)
    expect(failure.accountId).toBeDefined()
    expect(recorder.requests).toHaveLength(0)
  })

  it('is Delivery for an empty ChatGPT subscription token', async () => {
    const model = createOpenAiModel({
      credentials: holding(async () =>
        oauthCredential({ accessToken: '', providerAccountId: 'acct-1' }),
      ),
      providerId: 'openai',
      modelId: 'gpt-5.3-codex',
      fetch: recordingFetch({ body: '' }).fetch,
    })

    expect((await failureOf(() => model.doStream({ prompt: PROMPT }))).kind).toBe(
      EProviderFailureKind.Delivery,
    )
  })
})
