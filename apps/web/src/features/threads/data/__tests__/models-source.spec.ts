import { describe, expect, it } from 'bun:test'

import { EModelProviderStatus } from '@dltech/atlas-wire/web'

import { modelOptionsOfSource } from '../model-options'
import { loadModelsSource } from '../models-api'

const accounts = [{ provider: 'anthropic', status: 'active' }]
const live = { providers: [] }

describe('loadModelsSource', () => {
  it('uses the live response when /v1/models answers', async () => {
    const source = await loadModelsSource({
      loadModels: async () => live,
      loadAccounts: async () => {
        throw new Error('not needed')
      },
    })
    expect(source).toEqual({ kind: 'live', response: live })
  })

  it('falls back to the accounts when /v1/models fails', async () => {
    const source = await loadModelsSource({
      loadModels: async () => {
        throw new Error('503')
      },
      loadAccounts: async () => accounts,
    })
    expect(source).toEqual({ kind: 'accounts', accounts })
  })
})

describe('modelOptionsOfSource', () => {
  it('builds the static catalogue options on the fallback path', () => {
    const { models } = modelOptionsOfSource({ source: { kind: 'accounts', accounts } })
    expect(models[0]?.auto).toBe(true)
    expect(models.slice(1).every((model) => model.provider === 'Anthropic')).toBe(true)
  })

  it('builds the live options on the live path', () => {
    const response = {
      providers: [
        {
          id: 'openai',
          label: 'Codex Plan',
          status: EModelProviderStatus.Connected,
          live: true,
          models: [{ id: 'openai/only', label: 'Only', contextWindow: 1000, efforts: [] }],
        },
      ],
    }
    const { models } = modelOptionsOfSource({ source: { kind: 'live', response } })
    expect(models.map((model) => model.id)).toEqual(['auto', 'openai/only'])
  })

  it('is empty before the source loads', () => {
    expect(modelOptionsOfSource({ source: undefined })).toEqual({
      models: [],
      reconnectProviders: [],
    })
  })
})
