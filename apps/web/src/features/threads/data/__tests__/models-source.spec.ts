import { describe, expect, it } from 'bun:test'

import { EModelProviderStatus } from '@dltech/atlas-wire/web'

import { modelOptionsOfSource } from '../model-options'
import { loadModelsSource } from '../models-api'

const accounts = [{ provider: 'anthropic', status: 'active' }]
const live = { providers: [] }

describe('loadModelsSource', () => {
  it('uses the live response when models.list answers', async () => {
    const source = await loadModelsSource({
      loadModels: async () => live,
      loadAccounts: async () => {
        throw new Error('not needed')
      },
    })
    expect(source).toEqual({ kind: 'live', response: live })
  })

  it('falls back to the accounts when models.list fails', async () => {
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
    const connected = models.filter((model) => model.disabled !== true)
    expect(connected.length).toBeGreaterThan(0)
    expect(connected.every((model) => model.provider === 'Claude Plan')).toBe(true)
    expect(new Set(models.map((model) => model.provider)).size).toBe(4)
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
    expect(models.map((model) => model.id)).toEqual(['openai/only'])
  })

  it('is empty before the source loads', () => {
    expect(modelOptionsOfSource({ source: undefined })).toEqual({
      models: [],
      reconnectProviders: [],
    })
  })
})
