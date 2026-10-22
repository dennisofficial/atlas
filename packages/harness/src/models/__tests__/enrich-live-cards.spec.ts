import { describe, expect, it } from 'bun:test'

import { CONTEXT_WINDOW_UNMEASURED, EImageTier, type ModelCard } from '@dltech/atlas-core'

import { enrichLiveCards } from '../enrich-live-cards'

const card = (overrides: Partial<ModelCard> & { modelId?: string } = {}): ModelCard => {
  const { modelId = 'gpt-5.5', ...rest } = overrides
  return {
    ref: { providerId: 'openai', modelId },
    label: modelId,
    api: 'openai-responses',
    contextWindow: CONTEXT_WINDOW_UNMEASURED,
    imageTier: EImageTier.Standard,
    ...rest,
  }
}

const generatedFor = (modelId = 'gpt-5.5'): ModelCard =>
  card({
    modelId,
    label: 'generated label',
    api: 'generated-api',
    imageTier: EImageTier.HighResolution,
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    cost: { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125 },
  })

describe('enrichLiveCards', () => {
  it('fills cost, output cap and an unmeasured window from the matching generated card', () => {
    const [enriched] = enrichLiveCards({ live: [card()], generated: [generatedFor()] })

    expect(enriched?.cost).toEqual({
      inputPerMillion: 1.25,
      outputPerMillion: 10,
      cacheReadPerMillion: 0.125,
    })
    expect(enriched?.maxOutputTokens).toBe(128_000)
    expect(enriched?.contextWindow).toBe(400_000)
  })

  it('keeps the live ref, label, api and image tier', () => {
    const live = card({ label: 'GPT-5.5', api: 'codex-responses' })
    const [enriched] = enrichLiveCards({ live: [live], generated: [generatedFor()] })

    expect(enriched?.ref).toEqual(live.ref)
    expect(enriched?.label).toBe('GPT-5.5')
    expect(enriched?.api).toBe('codex-responses')
    expect(enriched?.imageTier).toBe(EImageTier.Standard)
  })

  it('lets present live values win over generated ones', () => {
    const live = card({
      contextWindow: 272_000,
      maxOutputTokens: 64_000,
      cost: { inputPerMillion: 2, outputPerMillion: 4 },
    })
    const [enriched] = enrichLiveCards({ live: [live], generated: [generatedFor()] })

    expect(enriched?.contextWindow).toBe(272_000)
    expect(enriched?.maxOutputTokens).toBe(64_000)
    expect(enriched?.cost).toEqual({ inputPerMillion: 2, outputPerMillion: 4 })
  })

  it('fills only the traits the live card lacks', () => {
    const live = card({ contextWindow: 272_000, maxOutputTokens: 64_000 })
    const [enriched] = enrichLiveCards({ live: [live], generated: [generatedFor()] })

    expect(enriched?.contextWindow).toBe(272_000)
    expect(enriched?.maxOutputTokens).toBe(64_000)
    expect(enriched?.cost?.inputPerMillion).toBe(1.25)
  })

  it('stays unmeasured when the generated window is unmeasured too', () => {
    const generated = { ...generatedFor(), contextWindow: CONTEXT_WINDOW_UNMEASURED }
    const [enriched] = enrichLiveCards({ live: [card()], generated: [generated] })

    expect(enriched?.contextWindow).toBe(CONTEXT_WINDOW_UNMEASURED)
  })

  it('leaves optional traits absent when neither source has them', () => {
    const bare = card({ modelId: 'bare' })
    const [enriched] = enrichLiveCards({ live: [bare], generated: [{ ...bare }] })

    expect(enriched).toEqual(bare)
    expect(enriched && 'cost' in enriched).toBe(false)
    expect(enriched && 'maxOutputTokens' in enriched).toBe(false)
  })

  it('passes a live card with no generated match through untouched', () => {
    const live = card({ modelId: 'codex-only' })
    const [enriched] = enrichLiveCards({ live: [live], generated: [generatedFor('other')] })

    expect(enriched).toBe(live)
  })

  it('does not match a generated card from another provider', () => {
    const elsewhere: ModelCard = {
      ...generatedFor(),
      ref: { providerId: 'openrouter', modelId: 'gpt-5.5' },
    }
    const [enriched] = enrichLiveCards({ live: [card()], generated: [elsewhere] })

    expect(enriched?.cost).toBeUndefined()
    expect(enriched?.contextWindow).toBe(CONTEXT_WINDOW_UNMEASURED)
  })

  it('preserves live ordering and does not mutate its inputs', () => {
    const live = [card({ modelId: 'b' }), card({ modelId: 'a' })]
    const generated = [generatedFor('a'), generatedFor('b')]
    const liveBefore = structuredClone(live)
    const generatedBefore = structuredClone(generated)

    const enriched = enrichLiveCards({ live, generated })

    expect(enriched.map((entry) => entry.ref.modelId)).toEqual(['b', 'a'])
    expect(enriched[0]).not.toBe(live[0])
    expect(live).toEqual(liveBefore)
    expect(generated).toEqual(generatedBefore)
  })
})
