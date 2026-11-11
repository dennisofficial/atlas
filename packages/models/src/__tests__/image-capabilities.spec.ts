import { describe, expect, it } from 'bun:test'
import { findCard, parseRef, type ModelCard } from '@dltech/atlas-core'

import { generatedCards, generatedCatalogue } from '../generated-catalogue'
import { imageCapabilitiesOf } from '../image-capabilities'

const SEES_IMAGES = ['text', 'image']
const TEXT_ONLY = ['text']

const cardAt = (reference: string): ModelCard | undefined => {
  const ref = parseRef(reference)
  return ref === undefined ? undefined : findCard({ catalog: generatedCatalogue(), ref })
}

describe('image capabilities by api', () => {
  it('lets anthropic-messages and openai-responses take a link or bytes', () => {
    expect(
      imageCapabilitiesOf({ api: 'anthropic-messages', inputModalities: SEES_IMAGES }).images,
    ).toBe('both')
    expect(
      imageCapabilitiesOf({ api: 'openai-responses', inputModalities: SEES_IMAGES }).images,
    ).toBe('both')
  })

  it('keeps the gateway and unknown apis on inline bytes', () => {
    expect(imageCapabilitiesOf({ api: 'ai-gateway', inputModalities: SEES_IMAGES }).images).toBe(
      'inline',
    )
    expect(imageCapabilitiesOf({ api: 'something-new', inputModalities: SEES_IMAGES }).images).toBe(
      'inline',
    )
  })

  it('turns away a model that publishes no image input, whatever its api', () => {
    for (const api of [
      'openai-completions',
      'anthropic-messages',
      'openai-responses',
      'ai-gateway',
    ]) {
      expect(imageCapabilitiesOf({ api, inputModalities: TEXT_ONLY }).images).toBe('none')
    }
  })

  it('takes a model at its api when no catalogue published its modalities', () => {
    expect(imageCapabilitiesOf({ api: 'openai-completions' }).images).toBe('inline')
    expect(imageCapabilitiesOf({ api: 'openai-responses' }).images).toBe('both')
  })
})

describe('the catalogue', () => {
  it('gives every card an image capability record', () => {
    expect(generatedCards().every((card) => card.image !== undefined)).toBe(true)
  })

  it('maps a published anthropic card to both', () => {
    expect(cardAt('anthropic/claude-haiku-4-5')?.image?.images).toBe('both')
  })

  it('turns away a published text-only model, which no pattern decided', () => {
    expect(cardAt('openrouter/meta-llama/llama-3.3-70b-instruct')?.image?.images).toBe('none')
    expect(cardAt('openrouter/deepseek/deepseek-chat')?.image?.images).toBe('none')
  })

  it('lets a published openrouter vision model take inline bytes', () => {
    expect(cardAt('openrouter/meta-llama/llama-4-scout')?.image?.images).toBe('inline')
  })
})
