import { describe, expect, it } from 'bun:test'

import { EEffort, EImageTier, type ModelCard } from '@dltech/atlas-core'

import { GATEWAY_PROVIDER_ID } from '../gateway-adapter'
import { gatewayReasoning } from '../gateway-effort'

const cardWith = (effort: ModelCard['effort']): ModelCard => ({
  ref: { providerId: GATEWAY_PROVIDER_ID, modelId: 'anthropic/claude-opus-5.5' },
  label: 'Claude Opus 5.5',
  api: 'ai-gateway',
  contextWindow: 1_000_000,
  imageTier: EImageTier.Standard,
  ...(effort === undefined ? {} : { effort }),
})

const OPUS = cardWith({
  [EEffort.Low]: 'low',
  [EEffort.Medium]: 'medium',
  [EEffort.High]: 'high',
  [EEffort.XHigh]: 'xhigh',
  [EEffort.Max]: 'max',
})

describe('gatewayReasoning', () => {
  it('sends a rung the model offers unchanged', () => {
    expect(gatewayReasoning({ card: OPUS, effort: EEffort.XHigh })).toBe('xhigh')
  })

  it('clamps a rung the model lacks to the nearest one it offers', () => {
    expect(gatewayReasoning({ card: OPUS, effort: EEffort.Off })).toBe('low')
  })

  it('sends nothing for a model with no effort control', () => {
    expect(gatewayReasoning({ card: cardWith(undefined), effort: EEffort.High })).toBeUndefined()
  })

  it('refuses a wire value the gateway does not accept', () => {
    const odd = cardWith({ [EEffort.Low]: 'instant' })
    expect(gatewayReasoning({ card: odd, effort: EEffort.Low })).toBeUndefined()
  })
})
