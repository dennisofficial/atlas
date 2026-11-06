import { describe, expect, it } from 'bun:test'

import { anthropicThinkingOptions, anthropicThinkingOptionsOf } from '../anthropic-thinking'

describe('anthropicThinkingOptionsOf', () => {
  it('asks adaptive cards for summarized thinking at the default effort', () => {
    expect(anthropicThinkingOptionsOf('claude-sonnet-4-6')).toEqual({
      anthropic: {
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'medium',
      },
    })
  })

  it('gives budget cards a thinking budget and no display', () => {
    expect(anthropicThinkingOptionsOf('claude-sonnet-4-5')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 2048 } },
    })
  })

  it('sends nothing for a model without a card', () => {
    expect(anthropicThinkingOptionsOf('claude-unknown')).toBeUndefined()
    expect(anthropicThinkingOptions(undefined)).toBeUndefined()
  })
})
