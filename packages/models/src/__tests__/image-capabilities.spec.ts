import { describe, expect, it } from 'bun:test'
import { findCard, parseRef, type ModelCard } from '@dltech/atlas-core'

import { generatedCards, generatedCatalogue } from '../generated-catalogue'
import { imageCapabilitiesOf } from '../image-capabilities'

const ref = (modelId: string): ModelCard['ref'] => ({ providerId: 'p', modelId })

describe('image capabilities by api', () => {
  it('lets anthropic-messages and openai-responses take a link or bytes', () => {
    expect(imageCapabilitiesOf({ api: 'anthropic-messages', ref: ref('claude-x') }).images).toBe(
      'both',
    )
    expect(imageCapabilitiesOf({ api: 'openai-responses', ref: ref('gpt-x') }).images).toBe('both')
  })

  it('keeps the gateway and unknown apis on inline bytes', () => {
    expect(imageCapabilitiesOf({ api: 'ai-gateway', ref: ref('a/b') }).images).toBe('inline')
    expect(imageCapabilitiesOf({ api: 'something-new', ref: ref('a') }).images).toBe('inline')
  })

  it('decides openai-completions per model', () => {
    const api = 'openai-completions'
    expect(imageCapabilitiesOf({ api, ref: ref('gpt-4o') }).images).toBe('inline')
    expect(imageCapabilitiesOf({ api, ref: ref('deepseek/deepseek-v3.2') }).images).toBe('none')
    expect(imageCapabilitiesOf({ api, ref: ref('meta-llama/llama-3.3-70b-instruct') }).images).toBe(
      'none',
    )
  })
})

describe('the catalogue', () => {
  it('gives every card an image capability record', () => {
    expect(generatedCards().every((card) => card.image !== undefined)).toBe(true)
  })

  it('maps a published anthropic card to both', () => {
    const parsed = parseRef('anthropic/claude-haiku-4-5')
    const card =
      parsed === undefined ? undefined : findCard({ catalog: generatedCatalogue(), ref: parsed })
    expect(card?.image?.images).toBe('both')
  })
})
