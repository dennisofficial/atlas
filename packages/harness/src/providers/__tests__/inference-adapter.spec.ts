import { describe, expect, it } from 'bun:test'
import { generateText } from 'ai'

import { EEffort, EImageTier, type CredentialPort, type ModelCard } from '@dltech/atlas-core'

import { apiKeyCredential } from '../../credentials/testing'
import { InferenceAdapter, INFERENCE_PROVIDER_ID } from '../inference-adapter'
import { recordingFetch } from './recording-fetch'

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
