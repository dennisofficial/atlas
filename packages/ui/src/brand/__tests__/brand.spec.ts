import { describe, expect, it } from 'bun:test'

import { BRAND_PATHS, brandOfProvider, EBrand } from '../index'

describe('brandOfProvider', () => {
  it('maps every connected model provider to its brand', () => {
    expect(brandOfProvider('anthropic')).toBe(EBrand.Anthropic)
    expect(brandOfProvider('openai')).toBe(EBrand.OpenAI)
    expect(brandOfProvider('openrouter')).toBe(EBrand.OpenRouter)
    expect(brandOfProvider('inference')).toBe(EBrand.Inference)
    expect(brandOfProvider('gateway')).toBe(EBrand.Vercel)
  })

  it('gives no brand to a provider it does not know', () => {
    expect(brandOfProvider('google')).toBeUndefined()
    expect(brandOfProvider('')).toBeUndefined()
  })
})

describe('BRAND_PATHS', () => {
  it('holds a titled path for every brand', () => {
    for (const brand of Object.values(EBrand)) {
      const path = BRAND_PATHS[brand]
      expect(path.title.length).toBeGreaterThan(0)
      expect(path.d.startsWith('M')).toBe(true)
    }
  })
})
