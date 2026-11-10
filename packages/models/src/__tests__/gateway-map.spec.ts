import { describe, expect, it } from 'bun:test'

import { mapGatewayModels } from '../../scripts/gateway-map'
import type { GatewayModel } from '../../scripts/vercel-gateway'
import { GATEWAY_API, GATEWAY_CATALOGUE_PROVIDER_ID } from '../generated-card'

const KIMI: GatewayModel = {
  id: 'moonshotai/kimi-k3-fast',
  name: 'Kimi K3 Fast',
  type: 'language',
  context_window: 1_000_000,
  max_tokens: 131_072,
  tags: ['reasoning', 'tool-use'],
  reasoning_options: [
    { type: 'toggle' },
    { type: 'effort', values: ['none', 'low', 'medium', 'high', 'max'] },
  ],
  pricing: { input: '0.0000045', output: '0.0000225', input_cache_read: '0.00000045' },
}

const model = (overrides: Partial<GatewayModel>): GatewayModel => ({ ...KIMI, ...overrides })

describe('mapGatewayModels', () => {
  it('maps a tool-calling language model to a gateway card', () => {
    const { cards } = mapGatewayModels([KIMI])

    expect(cards).toEqual([
      {
        ref: { providerId: GATEWAY_CATALOGUE_PROVIDER_ID, modelId: 'moonshotai/kimi-k3-fast' },
        label: 'Kimi K3 Fast',
        api: GATEWAY_API,
        contextWindow: 1_000_000,
        imageTier: 'standard',
        maxOutputTokens: 131_072,
        cost: { inputPerMillion: 4.5, outputPerMillion: 22.5, cacheReadPerMillion: 0.45 },
        effort: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
      },
    ])
  })

  it('skips non-language, batch-only and tool-less models', () => {
    const { cards, report } = mapGatewayModels([
      model({ id: 'openai/sora', type: 'video' }),
      model({ id: 'moonshotai/kimi-k3-batch' }),
      model({ id: 'acme/no-tools', tags: ['reasoning'] }),
      KIMI,
    ])

    expect(cards.map((card) => card.ref.modelId)).toEqual(['moonshotai/kimi-k3-fast'])
    expect(Object.values(report.skipped).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(3)
  })

  it('leaves effort off a model that offers only a token budget', () => {
    const { cards } = mapGatewayModels([model({ reasoning_options: [{ type: 'budget_tokens' }] })])
    expect(cards[0]?.effort).toBeUndefined()
  })

  it('reads a vendor model id on the high-resolution list at the high tier', () => {
    const { cards } = mapGatewayModels([model({ id: 'anthropic/claude-opus-5' })])
    expect(cards[0]?.imageTier).toBe('high-resolution')
  })

  it('omits a price the gateway does not publish', () => {
    const { cards } = mapGatewayModels([model({ pricing: undefined })])
    expect(cards[0]?.cost).toBeUndefined()
  })

  it('carries the input modalities the gateway publishes', () => {
    const { cards } = mapGatewayModels([
      model({ id: 'moonshotai/kimi-k3-fast', modalities: { input: ['text', 'image'] } }),
    ])

    expect(cards[0]?.inputModalities).toEqual(['text', 'image'])
  })

  it('leaves modalities off a row the gateway published none for', () => {
    const { cards } = mapGatewayModels([model({ modalities: undefined })])
    expect(cards[0]?.inputModalities).toBeUndefined()
  })
})
