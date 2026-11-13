import { describe, expect, it } from 'bun:test'

import { connectProviderAdvice, unavailableModelMessage } from '../unavailable-copy'

describe('unavailableModelMessage', () => {
  it('names the model and the missing provider', () => {
    expect(
      unavailableModelMessage({
        subject: 'Your main agent',
        modelLabel: 'GPT-5',
        providerLabel: 'OpenAI',
      }),
    ).toBe("Your main agent is set to GPT-5, but OpenAI isn't connected.")
  })
})

describe('connectProviderAdvice', () => {
  it('names both settings pages and the retry', () => {
    expect(connectProviderAdvice('OpenAI')).toBe(
      'Connect OpenAI in Settings → Providers, or pick another model in Settings → Models & Effort, then retry.',
    )
  })
})
