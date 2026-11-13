import { describe, expect, it } from 'bun:test'

import { EModelProviderStatus, type ModelsResponse } from '@dltech/atlas-wire/web'

import { modelOptionsFromResponse } from '../model-options'

const response = (providers: ModelsResponse['providers']): ModelsResponse => ({ providers })

const openAi = response([
  {
    id: 'openai',
    label: 'Codex Plan',
    status: EModelProviderStatus.Connected,
    live: true,
    models: [
      {
        id: 'openai/gpt-live',
        label: 'GPT Live',
        contextWindow: 400_000,
        imageTier: 'high-resolution',
        efforts: ['low', 'high', 'bogus'],
        inputPerMillion: 1.25,
        outputPerMillion: 10,
      },
      {
        id: 'openai/gpt-cheap',
        label: 'Cheap',
        contextWindow: 1_048_576,
        imageTier: 'standard',
        efforts: [],
        inputPerMillion: 0.2,
        outputPerMillion: 0.8,
      },
      { id: 'openai/gpt-free', label: 'Unpriced', contextWindow: 128_000, efforts: [] },
    ],
  },
])

describe('modelOptionsFromResponse', () => {
  it('maps each live model to an option with brand, context label, rate and efforts', () => {
    const { models, reconnectProviders } = modelOptionsFromResponse({ response: openAi })

    expect(models[0]).toMatchObject({
      id: 'openai/gpt-live',
      label: 'GPT Live',
      provider: 'Codex Plan',
      context: '400k',
      contextTokens: 400_000,
      efforts: ['low', 'high'],
      rate: '$10.00/M',
      monogram: 'C',
      images: true,
    })
    expect(models[0]?.disabled).toBeUndefined()
    expect(models[0]?.brand).toBeDefined()
    expect(models[1]).toMatchObject({ context: '1M', rate: '$0.80/M' })
    expect(models[1]?.images).toBe(false)
    expect(models[2]?.rate).toBeUndefined()
    expect(models[2]?.images).toBeUndefined()
    expect(reconnectProviders).toEqual([])
  })

  it('has no models when no provider is connected', () => {
    expect(modelOptionsFromResponse({ response: response([]) })).toEqual({
      models: [],
      reconnectProviders: [],
    })
    const keyless = modelOptionsFromResponse({
      response: response([
        {
          id: 'openrouter',
          label: 'OpenRouter',
          status: EModelProviderStatus.Unavailable,
          live: false,
          models: [{ id: 'openrouter/a/b', label: 'A B', contextWindow: 128_000, efforts: [] }],
        },
      ]),
    })
    expect(keyless.models).toEqual([])
  })

  it('turns an expired provider into a reconnect row with no models', () => {
    const { models, reconnectProviders } = modelOptionsFromResponse({
      response: response([
        {
          id: 'anthropic',
          label: 'Claude Plan',
          status: EModelProviderStatus.Expired,
          live: false,
          models: [],
        },
      ]),
    })

    expect(reconnectProviders).toEqual(['Claude Plan'])
    expect(models).toEqual([])
  })

  it('hides a provider with no key instead of offering its models', () => {
    const { models, reconnectProviders } = modelOptionsFromResponse({
      response: response([
        {
          id: 'openrouter',
          label: 'OpenRouter',
          status: EModelProviderStatus.Unavailable,
          live: false,
          models: [
            { id: 'openrouter/a/b', label: 'A B', contextWindow: 128_000, efforts: [] },
            { id: 'openrouter/c/d', label: 'C D', contextWindow: 128_000, efforts: [] },
          ],
        },
        ...openAi.providers,
      ]),
    })

    expect(reconnectProviders).toEqual([])
    expect(models.some((model) => model.provider === 'OpenRouter')).toBe(false)
    expect(models.some((model) => model.disabled)).toBe(false)
  })

  it('keeps the thread\u2019s own model listed when its provider lost its key', () => {
    const { models } = modelOptionsFromResponse({
      response: response([
        {
          id: 'openrouter',
          label: 'OpenRouter',
          status: EModelProviderStatus.Unavailable,
          live: false,
          models: [
            { id: 'openrouter/a/b', label: 'A B', contextWindow: 128_000, efforts: [] },
            { id: 'openrouter/c/d', label: 'C D', contextWindow: 128_000, efforts: [] },
          ],
        },
        ...openAi.providers,
      ]),
      currentIds: ['openrouter/c/d'],
    })

    const dormant = models.filter((model) => model.provider === 'OpenRouter')
    expect(dormant.map((model) => model.id)).toEqual(['openrouter/c/d'])
    expect(dormant[0]?.label).toBe('C D')
    expect(dormant[0]?.disabled).toBe(true)
    expect(dormant[0]?.disabledNote).toBe('OpenRouter not connected')
  })

  it('labels every provider with the same name the TUI switcher uses', () => {
    const providers = ['anthropic', 'openai', 'openrouter', 'inference'].map((id) => ({
      id,
      label: id,
      status: EModelProviderStatus.Connected,
      live: false,
      models: [{ id: `${id}/m`, label: 'M', contextWindow: 1000, efforts: [] }],
    }))
    const { models } = modelOptionsFromResponse({ response: response(providers) })
    expect(models.map((model) => model.provider)).toEqual([
      'Claude Plan',
      'Codex Plan',
      'OpenRouter',
      'Inference.net',
    ])
  })

  it('keeps a thread model the response no longer offers selectable', () => {
    const { models } = modelOptionsFromResponse({ response: openAi, currentIds: ['x/y'] })
    expect(models.find((model) => model.id === 'x/y')?.label).toBe('x/y')
    const offered = modelOptionsFromResponse({ response: openAi, currentIds: ['openai/gpt-live'] })
    expect(offered.models.filter((model) => model.id === 'openai/gpt-live')).toHaveLength(1)
  })
})
