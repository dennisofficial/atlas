import { describe, expect, it } from 'bun:test'

import { CONTEXT_WINDOW_UNMEASURED } from '../../ports/model.port'
import { cappedTraits, deployedInputCapFor } from '../input-caps'

const kimiK3 = { providerId: 'inference', modelId: 'kimi-k3' }

describe('deployedInputCapFor', () => {
  it('caps the deployed kimi-k3 replicas below their advertised window', () => {
    expect(deployedInputCapFor(kimiK3)).toBe(245_000)
    expect(deployedInputCapFor({ providerId: 'inference', modelId: 'kimi-k3-fast' })).toBe(245_000)
  })

  it('has no opinion about other models', () => {
    expect(deployedInputCapFor({ providerId: 'inference', modelId: 'glm-4.6' })).toBeUndefined()
    expect(deployedInputCapFor({ providerId: 'anthropic', modelId: 'kimi-k3' })).toBeUndefined()
  })
})

describe('cappedTraits', () => {
  it('shrinks an oversized advertised window to the deployed cap', () => {
    const traits = cappedTraits({ card: { ref: kimiK3 }, traits: { contextWindow: 1_048_576 } })

    expect(traits.contextWindow).toBe(245_000)
  })

  it('leaves an unmeasured window unmeasured', () => {
    const traits = cappedTraits({
      card: { ref: kimiK3 },
      traits: { contextWindow: CONTEXT_WINDOW_UNMEASURED },
    })

    expect(traits.contextWindow).toBe(CONTEXT_WINDOW_UNMEASURED)
  })

  it('leaves a genuinely smaller window alone', () => {
    const traits = cappedTraits({ card: { ref: kimiK3 }, traits: { contextWindow: 131_072 } })

    expect(traits.contextWindow).toBe(131_072)
  })

  it('leaves other traits and uncapped models untouched', () => {
    expect(cappedTraits({ card: { ref: kimiK3 }, traits: {} })).toEqual({})
    expect(
      cappedTraits({ card: { ref: { providerId: 'openai', modelId: 'gpt-5' } }, traits: { contextWindow: 1_048_576 } })
        .contextWindow,
    ).toBe(1_048_576)
  })
})
