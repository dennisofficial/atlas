import { describe, expect, it } from 'bun:test'

import { EModelProviderStatus, modelsResponseSchema } from '../web/models-wire'

const connected = {
  id: 'openai',
  label: 'Codex Plan',
  status: 'connected',
  live: true,
  models: [
    {
      id: 'openai/gpt-x',
      label: 'GPT X',
      contextWindow: 400_000,
      imageTier: 'standard',
      efforts: ['low', 'high'],
      inputPerMillion: 1.25,
    },
  ],
}

describe('modelsResponseSchema', () => {
  it('accepts connected and expired providers with an optional liveError', () => {
    const parsed = modelsResponseSchema.parse({
      providers: [
        connected,
        { ...connected, id: 'anthropic', status: 'expired', live: false, models: [] },
      ],
      liveError: 'codex models request failed: 500',
    })

    expect(parsed.providers[0]?.status).toBe(EModelProviderStatus.Connected)
    expect(parsed.providers[1]?.status).toBe(EModelProviderStatus.Expired)
    expect(parsed.liveError).toBe('codex models request failed: 500')
  })

  it('accepts a model without imageTier or price', () => {
    const { imageTier: _tier, inputPerMillion: _price, ...bare } = connected.models[0] ?? {}
    expect(
      modelsResponseSchema.safeParse({ providers: [{ ...connected, models: [bare] }] }).success,
    ).toBe(true)
  })

  it('accepts an unavailable provider carrying its catalogue models', () => {
    const parsed = modelsResponseSchema.parse({
      providers: [{ ...connected, id: 'openrouter', status: 'unavailable', live: false }],
    })

    expect(parsed.providers[0]?.status).toBe(EModelProviderStatus.Unavailable)
  })

  it('rejects an unknown status', () => {
    expect(
      modelsResponseSchema.safeParse({ providers: [{ ...connected, status: 'limited' }] }).success,
    ).toBe(false)
  })
})
