import { EAuthProvider, parseRef } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  DECISION_MODELS,
  EClassifierTransport,
  decisionModelOf,
  pricingOf,
  refKeyOf,
} from '../models'

describe('DECISION_MODELS', () => {
  it('gives every entry a unique ref', () => {
    const keys = DECISION_MODELS.map(refKeyOf)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('names a known auth provider for every entry', () => {
    const providers = new Set<string>(Object.values(EAuthProvider))
    for (const model of DECISION_MODELS) expect(providers.has(model.provider)).toBe(true)
  })

  it('gives every entry an endpoint and a request model', () => {
    for (const model of DECISION_MODELS) {
      expect(model.endpoint.startsWith('https://')).toBe(true)
      expect(model.model.length).toBeGreaterThan(0)
      expect(Object.values(EClassifierTransport)).toContain(model.transport)
    }
  })

  it('keeps the gateway entry on the Jev transport under the gateway provider', () => {
    const gateway = decisionModelOf('gateway/typesafe-ai/jev')
    expect(gateway?.transport).toBe(EClassifierTransport.Jev)
    expect(gateway?.provider).toBe(EAuthProvider.Gateway)
  })

  it('pins the gateway request model to a version instead of the moving alias', () => {
    const gateway = decisionModelOf('gateway/typesafe-ai/jev')
    expect(gateway?.model).toBe('typesafe-ai/jev-1.14.0')
    expect(DECISION_MODELS.every((model) => model.model !== 'typesafe-ai/jev')).toBe(true)
  })

  it('prices every entry per million tokens', () => {
    for (const model of DECISION_MODELS) {
      expect(model.inputUsdPerMillion).toBeGreaterThan(0)
      expect(model.outputUsdPerMillion).toBeGreaterThanOrEqual(0)
    }
  })

  it('reads the Jev prices and endpoint back from the table', () => {
    const jev = decisionModelOf('gateway/typesafe-ai/jev')
    expect(jev === undefined ? undefined : pricingOf(jev)).toEqual({
      endpoint: 'https://ai-gateway.vercel.sh/typesafe',
      inputUsdPerMillion: 0.042,
      outputUsdPerMillion: 0,
    })
  })
})

describe('decisionModelOf', () => {
  it('reads every ref back from the stored value', () => {
    for (const model of DECISION_MODELS) expect(decisionModelOf(refKeyOf(model))).toEqual(model)
  })

  it('answers undefined for a ref outside the table and for text that is not a ref', () => {
    expect(decisionModelOf('openai/gpt-5')).toBeUndefined()
    expect(decisionModelOf('nonsense')).toBeUndefined()
    expect(parseRef('nonsense')).toBeUndefined()
  })
})
