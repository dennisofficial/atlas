import { EModelProviderStatus, type ModelsResponse } from '@dltech/atlas-wire/web'
import { describe, expect, it } from 'bun:test'

import {
  NO_MODEL_LABEL,
  effortLabelOf,
  modelGroupsOf,
  modelOptionsOf,
  modelTriggerLabelOf,
  personalModelLabelOf,
  pinnedModelsOf,
  searchModelsOf,
  selectionOf,
  togglePinnedModel,
  withoutPinned,
} from '../model-options'

const response: ModelsResponse = {
  providers: [
    {
      id: 'anthropic',
      label: 'Anthropic',
      status: EModelProviderStatus.Connected,
      live: true,
      models: [
        {
          id: 'claude-opus-4',
          label: 'Claude Opus 4',
          contextWindow: 200_000,
          efforts: ['low', 'medium', 'high'],
          fast: true,
          inputPerMillion: 15,
          outputPerMillion: 75,
        },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      status: EModelProviderStatus.Connected,
      live: false,
      models: [
        { id: 'gpt-5', label: 'GPT-5', contextWindow: 1_000_000, efforts: [] },
        { id: 'gpt-5-mini', label: 'GPT-5 mini', contextWindow: 400_000, efforts: [] },
      ],
    },
    {
      id: 'google',
      label: 'Google',
      status: EModelProviderStatus.Expired,
      live: false,
      models: [{ id: 'gemini-2', label: 'Gemini 2', contextWindow: 1_000_000, efforts: ['low'] }],
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      status: EModelProviderStatus.Unavailable,
      live: false,
      models: [{ id: 'openrouter/x/y', label: 'Mystery', contextWindow: 128_000, efforts: [] }],
    },
  ],
}

describe('modelOptionsOf', () => {
  it('keeps every provider that holds a key, in the order served', () => {
    const options = modelOptionsOf(response)
    expect(options.map((option) => option.id)).toEqual(['claude-opus-4', 'gpt-5', 'gpt-5-mini'])
  })

  it('strips the Claude prefix and labels the context window', () => {
    const [opus, gpt] = modelOptionsOf(response)
    expect(opus?.label).toBe('Opus 4')
    expect(opus?.provider).toBe('Anthropic')
    expect(opus?.monogram).toBe('A')
    expect(opus?.context).toBe('200k')
    expect(gpt?.context).toBe('1M')
  })

  it('carries the output rate when the provider publishes one', () => {
    const [opus, gpt] = modelOptionsOf(response)
    expect(opus?.rate).toBe('$75.00/M')
    expect(gpt?.rate).toBeNull()
  })

  it('drops a provider with no key instead of listing its models', () => {
    const options = modelOptionsOf(response)
    expect(options.some((option) => option.provider === 'OpenRouter')).toBe(false)
  })

  it('marks the models that offer fast mode', () => {
    const [opus, gpt] = modelOptionsOf(response)
    expect(opus?.fast).toBe(true)
    expect(gpt?.fast).toBe(false)
  })
})

describe('modelGroupsOf', () => {
  it('groups consecutive models under their provider', () => {
    const groups = modelGroupsOf(modelOptionsOf(response))
    expect(groups.map((group) => [group.provider, group.models.length])).toEqual([
      ['Anthropic', 1],
      ['OpenAI', 2],
    ])
  })
})

describe('searchModelsOf', () => {
  const models = modelOptionsOf(response)

  it('keeps every model for an empty query', () => {
    expect(searchModelsOf({ models, query: '  ' })).toHaveLength(models.length)
  })

  it('matches a model label, case-insensitively', () => {
    expect(searchModelsOf({ models, query: 'MINI' }).map((model) => model.id)).toEqual([
      'gpt-5-mini',
    ])
    expect(searchModelsOf({ models, query: 'nothing here' })).toHaveLength(0)
  })

  it('matches a provider name', () => {
    expect(searchModelsOf({ models, query: 'openai' }).map((model) => model.id)).toEqual([
      'gpt-5',
      'gpt-5-mini',
    ])
  })
})

describe('effortLabelOf', () => {
  it('spells out the taller rungs', () => {
    expect(effortLabelOf('xhigh')).toBe('Extra high')
    expect(effortLabelOf('medium')).toBe('Medium')
  })
})

describe('selectionOf', () => {
  const models = modelOptionsOf(response)

  it('selects nothing while no model is picked', () => {
    expect(selectionOf({ models, modelId: null, effort: null, fast: false })).toBeNull()
  })

  it('clamps the asked effort to the one the model offers above it', () => {
    const selection = selectionOf({
      models,
      modelId: 'claude-opus-4',
      effort: 'xhigh',
      fast: false,
    })
    expect(selection?.effort).toBe('high')
  })

  it('keeps an offered effort', () => {
    const selection = selectionOf({ models, modelId: 'claude-opus-4', effort: 'low', fast: false })
    expect(selection?.effort).toBe('low')
  })

  it('falls back to medium when the model offers no efforts', () => {
    const selection = selectionOf({ models, modelId: 'gpt-5', effort: 'high', fast: false })
    expect(selection?.effort).toBe('medium')
  })

  it('keeps fast only on a model that offers it', () => {
    expect(selectionOf({ models, modelId: 'claude-opus-4', effort: 'low', fast: true })?.fast).toBe(
      true,
    )
    expect(selectionOf({ models, modelId: 'gpt-5', effort: null, fast: true })?.fast).toBe(false)
  })
})

describe('modelTriggerLabelOf', () => {
  const models = modelOptionsOf(response)

  it('reads Default while no model is picked', () => {
    expect(modelTriggerLabelOf({ models, selection: null })).toBe(NO_MODEL_LABEL)
  })

  it('names the picked model', () => {
    const selection = selectionOf({ models, modelId: 'claude-opus-4', effort: 'low', fast: false })
    expect(modelTriggerLabelOf({ models, selection })).toBe('Opus 4')
  })
})

describe('pinned models', () => {
  const models = modelOptionsOf(response)

  it('keeps the stored order and drops ids the account no longer offers', () => {
    const pinned = pinnedModelsOf({ models, pinned: ['gpt-5', 'gone/model', 'claude-opus-4'] })

    expect(pinned.map((model) => model.id)).toEqual(['gpt-5', 'claude-opus-4'])
  })

  it('leaves pinned models out of the provider groups', () => {
    const rest = withoutPinned({ models, pinned: ['gpt-5'] })

    expect(rest.map((model) => model.id)).not.toContain('gpt-5')
    expect(rest.map((model) => model.id)).toContain('gpt-5-mini')
  })

  it('toggles a pin on and off', () => {
    expect(togglePinnedModel({ pinned: ['a'], id: 'b' })).toEqual(['a', 'b'])
    expect(togglePinnedModel({ pinned: ['a', 'b'], id: 'a' })).toEqual(['b'])
  })
})

describe('personalModelLabelOf', () => {
  const models = modelOptionsOf(response)

  it('names the default model from the settings', () => {
    expect(personalModelLabelOf({ models, personalId: 'claude-opus-4' })).toBe('Opus 4')
  })

  it('has no label when the default is unset or unknown', () => {
    expect(personalModelLabelOf({ models, personalId: '' })).toBeNull()
    expect(personalModelLabelOf({ models, personalId: 'gone/model' })).toBeNull()
  })
})
