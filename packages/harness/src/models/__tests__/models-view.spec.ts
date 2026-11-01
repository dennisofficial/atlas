import { describe, expect, it } from 'bun:test'

import { EImageTier, type ModelCard } from '@dltech/atlas-core'

import { modelsView, type HeldAccount } from '../models-view'

const held = (args: Partial<HeldAccount> & Pick<HeldAccount, 'provider'>): HeldAccount => ({
  id: `acc_${args.provider}_${args.kind ?? 'oauth'}`,
  kind: 'oauth',
  status: 'active',
  ...args,
})

const LIVE: ModelCard = {
  ref: { providerId: 'openai', modelId: 'gpt-live-only' },
  label: 'Live Only',
  api: 'openai-responses',
  contextWindow: 123_000,
  imageTier: EImageTier.Standard,
}

const providerOf = (view: ReturnType<typeof modelsView>, id: string) =>
  view.find((provider) => provider.id === id)

describe('modelsView', () => {
  it('lists every catalogue provider as unavailable for a user holding no accounts', () => {
    const view = modelsView({ accounts: [] })

    expect(view.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'openrouter',
      'inference',
    ])
    for (const provider of view) {
      expect(provider.status).toBe('unavailable')
      expect(provider.models.length).toBeGreaterThan(0)
    }
  })

  it('lists every provider in catalogue order, held ones connected, the rest unavailable', () => {
    const view = modelsView({
      accounts: [
        held({ provider: 'openrouter', kind: 'api-key' }),
        held({ provider: 'anthropic' }),
      ],
    })

    expect(view.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'openrouter',
      'inference',
    ])
    expect(providerOf(view, 'anthropic')).toMatchObject({
      label: 'Claude Plan',
      status: 'connected',
      live: false,
    })
    expect(providerOf(view, 'openai')?.status).toBe('unavailable')
    expect(providerOf(view, 'openai')?.models.length).toBeGreaterThan(0)
    expect(providerOf(view, 'openrouter')?.status).toBe('connected')
    expect(providerOf(view, 'inference')?.status).toBe('unavailable')
  })

  it('ignores an account on a provider Atlas does not know', () => {
    const view = modelsView({ accounts: [held({ provider: 'mystery' })] })

    expect(view.map((provider) => provider.id)).toEqual([
      'anthropic',
      'openai',
      'openrouter',
      'inference',
    ])
    expect(view.every((provider) => provider.status === 'unavailable')).toBe(true)
  })

  it('marks a provider whose accounts are all expired and offers no models', () => {
    const view = modelsView({ accounts: [held({ provider: 'anthropic', status: 'expired' })] })

    expect(providerOf(view, 'anthropic')).toEqual({
      id: 'anthropic',
      label: 'Claude Plan',
      status: 'expired',
      live: false,
      models: [],
    })
  })

  it('keeps a provider connected while any account on it still works', () => {
    const view = modelsView({
      accounts: [
        held({ provider: 'anthropic', status: 'expired' }),
        held({ provider: 'anthropic', kind: 'api-key', status: 'limited' }),
      ],
    })

    expect(providerOf(view, 'anthropic')?.status).toBe('connected')
  })

  it('maps a model to its id, window, efforts and input price', () => {
    const model = providerOf(
      modelsView({ accounts: [held({ provider: 'anthropic' })] }),
      'anthropic',
    )?.models[0]

    expect(model?.id).toMatch(/^anthropic\//)
    expect(model?.contextWindow).toBeGreaterThan(0)
    expect(Array.isArray(model?.efforts)).toBe(true)
  })

  it('keeps the static OpenAI list for an API key, live false', () => {
    const view = modelsView({
      accounts: [held({ provider: 'openai', kind: 'api-key' })],
      liveCards: () => [LIVE],
    })

    expect(providerOf(view, 'openai')?.live).toBe(false)
    expect(providerOf(view, 'openai')?.models.map((m) => m.id)).not.toContain(
      'openai/gpt-live-only',
    )
  })

  it('replaces the static OpenAI list with the live one for a ChatGPT login', () => {
    const view = modelsView({
      accounts: [held({ provider: 'openai' })],
      liveCards: (providerId) => (providerId === 'openai' ? [LIVE] : undefined),
    })

    expect(providerOf(view, 'openai')).toMatchObject({
      live: true,
      models: [{ id: 'openai/gpt-live-only', label: 'Live Only', contextWindow: 123_000 }],
    })
  })

  it('falls back to the static list when a ChatGPT login has no live cards', () => {
    const view = modelsView({
      accounts: [held({ provider: 'openai' })],
      liveCards: () => undefined,
    })

    expect(providerOf(view, 'openai')?.live).toBe(false)
    expect(providerOf(view, 'openai')?.models.length).toBeGreaterThan(1)
  })
})
