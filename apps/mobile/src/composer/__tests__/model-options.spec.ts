import { EModelProviderStatus, type ModelsResponse } from '@dltech/atlas-wire/web'
import { describe, expect, it } from 'bun:test'

import {
  NO_MODEL_LABEL,
  effortLabelOf,
  modelOptionsOf,
  modelTriggerLabelOf,
  selectionOf,
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
        },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      status: EModelProviderStatus.Unavailable,
      live: false,
      models: [{ id: 'gpt-5', label: 'GPT-5', contextWindow: 1_000_000, efforts: [] }],
    },
    {
      id: 'google',
      label: 'Google',
      status: EModelProviderStatus.Expired,
      live: false,
      models: [{ id: 'gemini-2', label: 'Gemini 2', contextWindow: 1_000_000, efforts: ['low'] }],
    },
  ],
}

describe('modelOptionsOf', () => {
  it('flattens connected providers and drops expired ones', () => {
    const options = modelOptionsOf(response)
    expect(options.map((option) => option.id)).toEqual(['claude-opus-4', 'gpt-5'])
  })

  it('strips the Claude prefix and labels the context window', () => {
    const [opus, gpt] = modelOptionsOf(response)
    expect(opus?.label).toBe('Opus 4')
    expect(opus?.provider).toBe('Anthropic')
    expect(opus?.context).toBe('200k')
    expect(gpt?.context).toBe('1M')
  })

  it('disables models whose provider is not connected and notes them', () => {
    const [opus, gpt] = modelOptionsOf(response)
    expect(opus?.disabled).toBe(false)
    expect(opus?.note).toBeNull()
    expect(gpt?.disabled).toBe(true)
    expect(gpt?.note).toBe('no key')
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
    expect(selectionOf({ models, modelId: null, effort: null })).toBeNull()
  })

  it('clamps the asked effort to the one the model offers above it', () => {
    const selection = selectionOf({ models, modelId: 'claude-opus-4', effort: 'xhigh' })
    expect(selection?.effort).toBe('high')
  })

  it('keeps an offered effort', () => {
    const selection = selectionOf({ models, modelId: 'claude-opus-4', effort: 'low' })
    expect(selection?.effort).toBe('low')
  })

  it('falls back to medium when the model offers no efforts', () => {
    const selection = selectionOf({ models, modelId: 'gpt-5', effort: 'high' })
    expect(selection?.effort).toBe('medium')
  })
})

describe('modelTriggerLabelOf', () => {
  const models = modelOptionsOf(response)

  it('reads Default while no model is picked', () => {
    expect(modelTriggerLabelOf({ models, selection: null })).toBe(NO_MODEL_LABEL)
  })

  it('names the picked model', () => {
    const selection = selectionOf({ models, modelId: 'claude-opus-4', effort: 'low' })
    expect(modelTriggerLabelOf({ models, selection })).toBe('Opus 4')
  })
})
