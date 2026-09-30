import { afterEach, describe, expect, it } from 'bun:test'
import {
  ATLAS_SETTINGS,
  EEffort,
  EImageTier,
  type CredentialPort,
  type ModelCard,
} from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { apiKeyCredential } from '../../credentials/testing'
import { InferenceAdapter } from '../../providers/inference-adapter'
import { recordingFetch } from '../../providers/__tests__/recording-fetch'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { childModelSource } from '../child-model'
import { selectableModel } from '../model-selection'
import { askModel, childModelFixture, childType, cleanupHomes } from './child-model-fixtures'

const card: ModelCard = {
  ref: { providerId: 'inference', modelId: 'kimi-k3-fast' },
  label: 'kimi-k3-fast',
  api: 'openai-completions',
  contextWindow: 1_000_000,
  imageTier: EImageTier.Standard,
  effort: { [EEffort.Low]: 'low', [EEffort.High]: 'high' },
}

const credentials: CredentialPort = {
  read: async () => apiKeyCredential({ apiKey: 'test-key' }),
  discard: async () => undefined,
}

const response = () => new Response([
  'data: ' + JSON.stringify({
    id: 'reply', object: 'chat.completion.chunk', created: 1, model: card.ref.modelId,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }],
  }),
  'data: ' + JSON.stringify({
    id: 'reply', object: 'chat.completion.chunk', created: 1, model: card.ref.modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }),
  'data: [DONE]',
].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } })

afterEach(cleanupHomes)

describe('a child through the real provider adapter', () => {
  it('keeps model and reasoning effort in the outbound request after the parent changes effort', async () => {
    const fixture = await childModelFixture()
    const recorder = recordingFetch({ body: await response().text() })
    const adapter = new InferenceAdapter({ credentials, cards: [card], fetch: recorder.fetch })
    const models = {
      ...fixture.models,
      cardFor: () => card,
      adapterFor: () => adapter,
    }
    const parent = selectableModel({ catalogue: models, initial: { ref: card.ref, effort: EEffort.Low } })
    const child = await childModelSource({
      models,
      model: parent,
      threads: fixture.threads,
      hooks: () => new HookChain({}),
      settings: createSettingsService({ definitions: ATLAS_SETTINGS, user: new MemorySettingsStore({}) }),
    })({ threadId: fixture.threadId, agentType: childType() })

    expect(await askModel(child)).toBe('hello')
    parent.select({ ref: card.ref, effort: EEffort.High })
    expect(await askModel(child)).toBe('hello')
    expect(recorder.requests).toHaveLength(2)
    for (const request of recorder.requests)
      expect(request.body).toMatchObject({ model: card.ref.modelId, reasoning_effort: 'low' })
  })
})
