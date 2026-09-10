import { describe, expect, it } from 'bun:test'
import { generateText } from 'ai'

import { EEffort, EImageTier, type CredentialPort, type ModelCard } from '@dltech/atlas-core'

import { apiKeyCredential, oauthCredential } from '../../credentials/testing'
import { OpenAiAdapter } from '../openai-adapter'
import { recordingFetch } from './recording-fetch'

const RESPONSE_JSON = JSON.stringify({
  id: 'resp_stub',
  object: 'response',
  created_at: 1_767_225_600,
  status: 'completed',
  model: 'gpt-5.3-codex',
  output: [
    {
      type: 'message',
      id: 'msg_stub',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'pong', annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
})

const credentials: CredentialPort = {
  read: async () => apiKeyCredential({ apiKey: 'sk-test' }),
  discard: async () => undefined,
}

const cardFor = (modelId: string): ModelCard => ({
  ref: { providerId: 'openai', modelId },
  label: modelId,
  api: 'openai-responses',
  contextWindow: 400_000,
  imageTier: EImageTier.Standard,
  effort: { [EEffort.High]: 'high' },
})

const adapterOn = (
  modelId: string,
  fetch: ConstructorParameters<typeof OpenAiAdapter>[0]['fetch'],
): OpenAiAdapter => new OpenAiAdapter({ credentials, cards: [cardFor(modelId)], fetch })

const singleExchange = async (modelId: string): Promise<unknown> => {
  const recorder = recordingFetch({ body: RESPONSE_JSON, contentType: 'application/json' })
  const adapter = adapterOn(modelId, recorder.fetch)
  const model = adapter.model({ card: cardFor(modelId), effort: () => EEffort.High })

  await generateText({ model, prompt: 'ping' })

  return recorder.requests[0]?.body
}

describe('the openai adapter merging provider options', () => {
  it('asks for 24h cache retention alongside the effort rung', async () => {
    expect(await singleExchange('gpt-5.3-codex')).toMatchObject({
      prompt_cache_retention: '24h',
      reasoning: { effort: 'high' },
    })
  })

  it('sends no retention parameter to a model on the new cache scheme', async () => {
    const body = (await singleExchange('gpt-5.6-terra')) as Record<string, unknown>

    expect(body['prompt_cache_retention']).toBeUndefined()
    expect(body).toMatchObject({ reasoning: { effort: 'high' } })
  })

  it('passes a caller cache key through to the codex backend without retention', async () => {
    const recorder = recordingFetch({ body: RESPONSE_JSON, contentType: 'application/json' })
    const adapter = new OpenAiAdapter({
      credentials: {
        read: async () =>
          oauthCredential({ accessToken: 'token-one', providerAccountId: 'acct-123' }),
        discard: async () => undefined,
      },
      cards: [cardFor('gpt-5.3-codex')],
      fetch: recorder.fetch,
    })
    const model = adapter.model({ card: cardFor('gpt-5.3-codex'), effort: () => EEffort.High })

    await generateText({
      model,
      prompt: 'ping',
      providerOptions: { openai: { promptCacheKey: 'thread-1' } },
    })

    const body = recorder.requests[0]?.body as Record<string, unknown>
    expect(body).toMatchObject({ prompt_cache_key: 'thread-1', store: false })
    expect(body['prompt_cache_retention']).toBeUndefined()
  })

  it('lets the caller override the retention default', async () => {
    const recorder = recordingFetch({ body: RESPONSE_JSON, contentType: 'application/json' })
    const adapter = adapterOn('gpt-5.3-codex', recorder.fetch)
    const model = adapter.model({ card: cardFor('gpt-5.3-codex'), effort: () => EEffort.High })

    await generateText({
      model,
      prompt: 'ping',
      providerOptions: { openai: { promptCacheRetention: 'in_memory' } },
    })

    expect(recorder.requests[0]?.body).toMatchObject({
      prompt_cache_retention: 'in_memory',
      reasoning: { effort: 'high' },
    })
  })
})
