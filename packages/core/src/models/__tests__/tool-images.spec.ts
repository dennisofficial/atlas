import { describe, expect, it } from 'bun:test'

import { carriesToolResultImages, OPENAI_COMPLETIONS_API } from '../card'

describe('carriesToolResultImages', () => {
  it('refuses only the completions API, whose provider stringifies tool results into text', () => {
    expect(carriesToolResultImages({ api: OPENAI_COMPLETIONS_API })).toBe(false)
    expect(carriesToolResultImages({ api: 'openai-responses' })).toBe(true)
    expect(carriesToolResultImages({ api: 'anthropic-messages' })).toBe(true)
  })

  it('assumes an uncatalogued model carries them, preserving the status quo', () => {
    expect(carriesToolResultImages(undefined)).toBe(true)
  })
})
