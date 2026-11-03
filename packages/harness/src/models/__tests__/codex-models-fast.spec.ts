import { describe, expect, it } from 'bun:test'

import { ModelsResponseSchema, toCodexModelCards } from '../codex-models-response'

const cardOf = (fields: Record<string, unknown>) => {
  const parsed = ModelsResponseSchema.parse({
    models: [{ slug: 'gpt-6.1-sol', visibility: 'list', ...fields }],
  })
  return toCodexModelCards({ models: parsed.models, providerId: 'openai' })[0]
}

describe('fast mode on a live Codex card', () => {
  it('is offered when the plan lists the priority service tier', () => {
    expect(cardOf({ service_tiers: [{ id: 'priority', name: 'Fast' }] })?.fast).toBe(true)
  })

  it('is offered through the deprecated fast speed tier too', () => {
    expect(cardOf({ additional_speed_tiers: ['fast'] })?.fast).toBe(true)
  })

  it('is absent when the model lists no fast tier', () => {
    expect(cardOf({ service_tiers: [{ id: 'flex', name: 'Flex' }] })).not.toHaveProperty('fast')
  })
})
