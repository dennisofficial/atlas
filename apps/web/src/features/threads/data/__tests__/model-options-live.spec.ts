import { describe, expect, it } from 'bun:test'

import { EModelProviderStatus, type ModelsResponse } from '@dltech/atlas-wire/web'

import { AUTO_MODEL_ID, modelOptionsFromResponse } from '../model-options'

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
        efforts: ['low', 'high', 'bogus'],
        inputPerMillion: 1.25,
      },
      {
        id: 'openai/gpt-cheap',
        label: 'Cheap',
        contextWindow: 1_048_576,
        efforts: [],
        inputPerMillion: 0.2,
      },
      { id: 'openai/gpt-free', label: 'Unpriced', contextWindow: 128_000, efforts: [] },
    ],
  },
])

describe('modelOptionsFromResponse', () => {
  it('maps each live model to an option with brand, context label, rate and efforts', () => {
    const { models, reconnectProviders } = modelOptionsFromResponse({ response: openAi })

    expect(models[0]).toEqual({ id: AUTO_MODEL_ID, label: 'Atlas picks', auto: true, efforts: [] })
    expect(models[1]).toMatchObject({
      id: 'openai/gpt-live',
      label: 'GPT Live',
      provider: 'OpenAI',
      context: '400k',
      contextTokens: 400_000,
      efforts: ['low', 'high'],
      rate: '$$',
      monogram: 'O',
    })
    expect(models[1]?.brand).toBeDefined()
    expect(models[2]).toMatchObject({ context: '1M', rate: '$' })
    expect(models[3]?.rate).toBeUndefined()
    expect(reconnectProviders).toEqual([])
  })

  it('omits Auto when asked and has none without models', () => {
    expect(modelOptionsFromResponse({ response: openAi, includeAuto: false }).models[0]?.id).toBe(
      'openai/gpt-live',
    )
    expect(modelOptionsFromResponse({ response: response([]) })).toEqual({
      models: [],
      reconnectProviders: [],
    })
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

    expect(reconnectProviders).toEqual(['Anthropic'])
    expect(models).toEqual([])
  })

  it('keeps a thread model the response no longer offers selectable', () => {
    const { models } = modelOptionsFromResponse({ response: openAi, currentId: 'x/y' })
    expect(models.find((model) => model.id === 'x/y')?.label).toBe('x/y')
    const offered = modelOptionsFromResponse({ response: openAi, currentId: 'openai/gpt-live' })
    expect(offered.models.filter((model) => model.id === 'openai/gpt-live')).toHaveLength(1)
  })
})
