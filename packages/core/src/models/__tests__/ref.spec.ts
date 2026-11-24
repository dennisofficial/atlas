import { describe, expect, it } from 'bun:test'

import { parseRef, refKey, UnknownModelRefError } from '../ref'

describe('parseRef', () => {
  it('splits a reference on its first slash', () => {
    expect(parseRef('anthropic/claude-opus-5')).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-5',
    })
  })

  it('keeps later slashes with the model, so a routed id survives', () => {
    expect(parseRef('openrouter/anthropic/claude-opus-4.5')).toEqual({
      providerId: 'openrouter',
      modelId: 'anthropic/claude-opus-4.5',
    })
  })

  it('refuses a reference that names no provider', () => {
    expect(parseRef('claude-opus-5')).toBeUndefined()
  })

  it('refuses a reference whose halves are not both present', () => {
    expect(parseRef('anthropic/')).toBeUndefined()
    expect(parseRef('/claude-opus-5')).toBeUndefined()
  })
})

describe('refKey', () => {
  it('rejoins what parseRef split', () => {
    const reference = 'openrouter/anthropic/claude-opus-4.5'
    const parsed = parseRef(reference)

    expect(parsed).toBeDefined()
    expect(refKey(parsed!)).toBe(reference)
  })
})

describe('UnknownModelRefError', () => {
  it('names the ref, the form and every ref that carries a bare id', () => {
    const error = new UnknownModelRefError({
      ref: 'claude-opus-5-5',
      candidates: [
        { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
        { providerId: 'inference', modelId: 'claude-opus-5-5' },
      ],
    })

    expect(error.message).toBe(
      'Unknown model "claude-opus-5-5". Use the form "<provider>/<model>". Did you mean anthropic/claude-opus-5-5 or inference/claude-opus-5-5?',
    )
    expect(error.name).toBe('UnknownModelRefError')
    expect(error.ref).toBe('claude-opus-5-5')
  })

  it('states only the form when no ref carries the id', () => {
    const error = new UnknownModelRefError({ ref: 'anthropic/' })

    expect(error.message).toBe('Unknown model "anthropic/". Use the form "<provider>/<model>".')
  })
})
