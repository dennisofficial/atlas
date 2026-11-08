import { describe, expect, test } from 'bun:test'

import {
  EImageDelivery,
  planDelivery,
  planInlineDelivery,
  type ImageCapabilities,
} from '../delivery'
import { MAX_API_EDGE, MAX_INLINE_BYTES } from '../limits'

const SEVEN_MB = 7 * 1024 * 1024

const inlineOnly: ImageCapabilities = { images: 'inline', maxInlineBytes: MAX_INLINE_BYTES }
const byUrl: ImageCapabilities = { images: 'both', maxInlineBytes: MAX_INLINE_BYTES }
const blind: ImageCapabilities = { images: 'none', maxInlineBytes: MAX_INLINE_BYTES }

const both = { inline: true, url: true }

describe('planDelivery', () => {
  test('an inline-only model gets a 7 MB picture as a path', () => {
    const plan = planDelivery({
      facts: { byteLength: SEVEN_MB },
      capabilities: inlineOnly,
      sources: { inline: true, url: false },
    })

    expect(plan.delivery).toBe(EImageDelivery.PathOnly)
    expect(plan.reason).toContain('inline limit')
  })

  test('a url-capable model gets the same picture as a url', () => {
    expect(
      planDelivery({ facts: { byteLength: SEVEN_MB }, capabilities: byUrl, sources: both }),
    ).toEqual({ delivery: EImageDelivery.Url })
  })

  test('a url-capable model with no resolver falls back to inline when the bytes fit', () => {
    expect(
      planDelivery({
        facts: { byteLength: 1000 },
        capabilities: byUrl,
        sources: { inline: true, url: false },
      }),
    ).toEqual({ delivery: EImageDelivery.Inline })
  })

  test('a url-capable model with no resolver sends a heavy picture as a path with the reason', () => {
    const plan = planDelivery({
      facts: { byteLength: SEVEN_MB },
      capabilities: byUrl,
      sources: { inline: true, url: false },
    })

    expect(plan.delivery).toBe(EImageDelivery.PathOnly)
    expect(plan.reason).toContain('inline limit')
  })

  test('a url-only model with no url gives a path and says why', () => {
    const plan = planDelivery({
      facts: { byteLength: 10 },
      capabilities: { images: 'url', maxInlineBytes: 0 },
      sources: { inline: true, url: false },
    })

    expect(plan.delivery).toBe(EImageDelivery.PathOnly)
    expect(plan.reason).toContain('link')
  })

  test('a model that cannot see images always gets a path', () => {
    for (const sources of [both, { inline: true, url: false }, { inline: false, url: true }]) {
      const plan = planDelivery({ facts: { byteLength: 10 }, capabilities: blind, sources })

      expect(plan.delivery).toBe(EImageDelivery.PathOnly)
      expect(plan.reason).toContain('cannot see')
    }
  })

  test('a long edge past the model ceiling is a path even when a url exists', () => {
    const plan = planDelivery({
      facts: { byteLength: 10, width: MAX_API_EDGE + 1, height: 10 },
      capabilities: { ...byUrl, maxEdge: MAX_API_EDGE },
      sources: both,
    })

    expect(plan.delivery).toBe(EImageDelivery.PathOnly)
    expect(plan.reason).toContain(String(MAX_API_EDGE))
  })

  test('a picture with no copy of its bytes is a path for an inline model', () => {
    const plan = planDelivery({
      facts: { byteLength: 10 },
      capabilities: inlineOnly,
      sources: { inline: false, url: false },
    })

    expect(plan.delivery).toBe(EImageDelivery.PathOnly)
  })
})

describe('planInlineDelivery, the provider-neutral ceiling', () => {
  test('inlines an ordinary screenshot and a large-edge photo', () => {
    expect(planInlineDelivery({ byteLength: 400_000, width: 1440, height: 900 }).delivery).toBe(
      EImageDelivery.Inline,
    )
    expect(planInlineDelivery({ byteLength: 3_500_000, width: 6000, height: 4000 }).delivery).toBe(
      EImageDelivery.Inline,
    )
  })

  test('refuses past the edge and byte ceilings', () => {
    expect(
      planInlineDelivery({ byteLength: 1000, width: MAX_API_EDGE + 1, height: 10 }).delivery,
    ).toBe(EImageDelivery.PathOnly)
    expect(planInlineDelivery({ byteLength: MAX_INLINE_BYTES + 1 }).delivery).toBe(
      EImageDelivery.PathOnly,
    )
  })
})
