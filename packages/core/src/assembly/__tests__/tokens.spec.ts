import { describe, expect, it } from 'bun:test'

import { toEventId } from '../../events/ids'
import type { Assembled } from '../assembled'
import { DEFAULT_IMAGE_TIER } from '../../images/projection'
import { DEFAULT_IMAGE_COST, EImagePricing, estimateTokensFor, estimateTokens } from '../tokens'

const origin = { eventId: toEventId('event-1'), seq: 1 }

describe('estimateTokens', () => {
  it('counts an empty prompt as nothing', () => {
    expect(estimateTokens({ system: [], messages: [] })).toBe(0)
  })

  it('counts system blocks and message parts at four characters per token', () => {
    const assembled: Assembled = {
      system: [{ text: '12345678' }],
      messages: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: '1234' },
              { type: 'text', text: '123456789012' },
            ],
          },
          origin,
        },
      ],
    }

    expect(estimateTokens(assembled)).toBe(2 + 1 + 3)
  })

  const assembledWithImage = (width: number, height: number): Assembled => ({
    system: [],
    messages: [
      {
        message: {
          role: 'user',
          content: [{ type: 'image', data: '', mediaType: 'image/png', width, height }],
        },
        origin,
      },
    ],
  })

  it('clamps a huge image to its tier by default', () => {
    expect(estimateTokens(assembledWithImage(5120, 5120))).toBe(1_521)
  })

  it('charges the same image by its actual patches under actual-patch pricing', () => {
    const charged = estimateTokensFor({
      tier: DEFAULT_IMAGE_TIER,
      pricing: EImagePricing.ActualPatches,
    })(assembledWithImage(5120, 5120))

    expect(charged).toBe(Math.ceil(5120 / 28) ** 2)
  })

  it('prices every other part identically under actual-patch pricing', () => {
    const text: Assembled = {
      system: [{ text: '12345678' }],
      messages: [
        { message: { role: 'assistant', content: [{ type: 'text', text: '1234' }] }, origin },
      ],
    }

    expect(estimateTokensFor({ tier: DEFAULT_IMAGE_TIER, pricing: EImagePricing.ActualPatches })(text)).toBe(
      estimateTokens(text),
    )
    expect(DEFAULT_IMAGE_COST.pricing).toBe(EImagePricing.TierProjection)
  })
})
