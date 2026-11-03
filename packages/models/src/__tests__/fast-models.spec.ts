import { describe, expect, it } from 'bun:test'

import { cardsForProvider } from '../generated-catalogue'

const fastIds = () =>
  cardsForProvider('anthropic')
    .filter((card) => card.fast === true)
    .map((card) => card.ref.modelId)
    .sort()

describe('the Claude models that offer fast mode', () => {
  it('are Opus 5.5 and Opus 5, and nothing else', () => {
    expect(fastIds()).toEqual(['claude-opus-5', 'claude-opus-5-5'])
  })

  it('leave every other provider to say so itself', () => {
    expect(cardsForProvider('openrouter').some((card) => card.fast === true)).toBe(false)
  })
})
