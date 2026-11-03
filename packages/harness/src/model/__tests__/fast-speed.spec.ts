import { describe, expect, it } from 'bun:test'

import { reportsFastSpeed } from '../fast-speed'

describe('reportsFastSpeed', () => {
  it('reads the speed Anthropic says the request ran at', () => {
    expect(reportsFastSpeed({ anthropic: { usage: { output_tokens: 3, speed: 'fast' } } })).toBe(
      true,
    )
  })

  it('treats a standard run, or a provider that reports no speed, as not fast', () => {
    expect(reportsFastSpeed({ anthropic: { usage: { speed: 'standard' } } })).toBe(false)
    expect(reportsFastSpeed({ openai: { serviceTier: 'default' } })).toBe(false)
    expect(reportsFastSpeed(undefined)).toBe(false)
  })
})
