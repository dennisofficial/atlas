import { describe, expect, it } from 'bun:test'

import { CONTEXT_WINDOW_UNMEASURED, EEffort, EImageTier } from '@dltech/atlas-core'

import { ModelsResponseSchema, toCodexModelCards } from '../codex-models-response'

const wire = {
  models: [
    {
      slug: 'gpt-5.1-codex-mini',
      display_name: 'GPT-5.1 Codex Mini',
      description: 'small',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low', description: 'fast' },
        { effort: 'medium', description: 'balanced' },
      ],
      visibility: 'list',
      priority: 20,
      supported_in_api: true,
      minimal_client_version: '0.1.0',
      context_window: 272_000,
      max_context_window: 872_000,
      upgrade: null,
      input_modalities: ['text', 'image'],
    },
    {
      slug: 'gpt-5.1-codex',
      display_name: 'GPT-5.1 Codex',
      supported_reasoning_levels: [
        { effort: 'low', description: '' },
        { effort: 'turbo', description: 'unknown rung' },
        { effort: 'high', description: '' },
        { effort: 'xhigh', description: '' },
      ],
      visibility: 'list',
      priority: 5,
      context_window: 400_000,
    },
    { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide', priority: 1 },
    { slug: 'none-model', display_name: 'None', visibility: 'none', priority: 2 },
  ],
}

const cards = () =>
  toCodexModelCards({ models: ModelsResponseSchema.parse(wire).models, providerId: 'openai' })

const windowOf = (fields: Record<string, number>): number => {
  const parsed = ModelsResponseSchema.parse({
    models: [{ slug: 'w', visibility: 'list', ...fields }],
  })
  const [card] = toCodexModelCards({ models: parsed.models, providerId: 'openai' })
  return card?.contextWindow ?? -1
}

describe('toCodexModelCards', () => {
  it('keeps only listed models, ordered by ascending priority', () => {
    expect(cards().map((card) => card.ref.modelId)).toEqual([
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
    ])
  })

  it('maps label, window, api and image tier', () => {
    const [first] = cards()

    expect(first).toMatchObject({
      ref: { providerId: 'openai', modelId: 'gpt-5.1-codex' },
      label: 'GPT-5.1 Codex',
      api: 'openai-responses',
      contextWindow: 400_000,
      imageTier: EImageTier.Standard,
    })
  })

  it('uses the larger of context_window and max_context_window as the ceiling', () => {
    const mini = cards().find((card) => card.ref.modelId === 'gpt-5.1-codex-mini')

    expect(mini?.contextWindow).toBe(872_000)
    expect(windowOf({ context_window: 272_000, max_context_window: 872_000 })).toBe(872_000)
    expect(windowOf({ context_window: 872_000, max_context_window: 272_000 })).toBe(872_000)
  })

  it('keeps context_window when max_context_window is absent', () => {
    expect(windowOf({ context_window: 272_000 })).toBe(272_000)
  })

  it('uses max_context_window when context_window is absent', () => {
    expect(windowOf({ max_context_window: 872_000 })).toBe(872_000)
  })

  it('reports the window as unmeasured when neither field is sent', () => {
    expect(windowOf({})).toBe(CONTEXT_WINDOW_UNMEASURED)
  })

  it('builds the effort map with the literal as the wire value and drops unknown rungs', () => {
    const [first, second] = cards()

    expect(first?.effort).toEqual({
      [EEffort.Low]: 'low',
      [EEffort.High]: 'high',
      [EEffort.XHigh]: 'xhigh',
    })
    expect(second?.effort).toEqual({ [EEffort.Low]: 'low', [EEffort.Medium]: 'medium' })
  })

  it('carries no cost and no output ceiling', () => {
    for (const card of cards()) {
      expect(card.cost).toBeUndefined()
      expect(card.maxOutputTokens).toBeUndefined()
    }
  })

  it('omits effort entirely when no rung is recognised', () => {
    const parsed = ModelsResponseSchema.parse({
      models: [
        {
          slug: 'odd',
          visibility: 'list',
          supported_reasoning_levels: [{ effort: 'turbo' }],
        },
      ],
    })

    const [card] = toCodexModelCards({ models: parsed.models, providerId: 'openai' })

    expect(card?.effort).toBeUndefined()
    expect(card?.label).toBe('odd')
  })
})
