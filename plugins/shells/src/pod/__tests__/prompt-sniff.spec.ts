import { describe, expect, it } from 'bun:test'

import { looksLikePrompt } from '../prompt-sniff'

describe('looksLikePrompt', () => {
  it('is true for a tail that asks without a newline', () => {
    expect(looksLikePrompt('Install deps? (y/n)')).toBe(true)
    expect(looksLikePrompt('Password: ')).toBe(true)
    expect(looksLikePrompt('building\nContinue? ')).toBe(true)
    expect(looksLikePrompt('$ ')).toBe(true)
  })

  it('is false once the output ends in a newline or is empty', () => {
    expect(looksLikePrompt('ls\n')).toBe(false)
    expect(looksLikePrompt('Continue?\n')).toBe(false)
    expect(looksLikePrompt('')).toBe(false)
  })

  it('is false for plain output that does not end like a prompt', () => {
    expect(looksLikePrompt('tick 3')).toBe(false)
  })
})
