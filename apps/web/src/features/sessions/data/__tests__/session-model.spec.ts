import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-ui/ai/model-selector'

import { createFieldsOf } from '@/features/threads/data/model-selection'

import { sessionModelOf, sessionSelectionOf } from '../session-model'

describe('sessionModelOf', () => {
  it('reads the pinned model off a session row', () => {
    expect(
      sessionModelOf({ model: { ref: 'anthropic/opus', effort: 'high', fast: false } }),
    ).toEqual({ ref: 'anthropic/opus', effort: 'high', fast: false })
  })

  it('has no model for a row that is not listed yet', () => {
    expect(sessionModelOf(undefined)).toBeNull()
  })
})

describe('sessionSelectionOf', () => {
  it('always selects the session model', () => {
    expect(
      sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false }),
    ).toEqual({ id: 'anthropic/claude-opus-5-5', effort: EEffort.High, fast: false })
  })

  it('carries the fast flag', () => {
    expect(
      sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'low', fast: true }),
    ).toEqual({ id: 'anthropic/claude-opus-5-5', effort: EEffort.Low, fast: true })
  })

  it('keeps the session effort as it was pinned', () => {
    expect(sessionSelectionOf({ ref: 'openai/gpt-5', effort: 'medium', fast: false }).effort).toBe(
      EEffort.Medium,
    )
  })
})

describe('model-set args of a session selection', () => {
  it('sends the plain ref and the effort, with no account', () => {
    const args = createFieldsOf(
      sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false }),
    )
    expect(args).toEqual({ model: 'anthropic/claude-opus-5-5', effort: 'high' })
    expect('accountId' in args).toBe(false)
  })

  it('adds fast only when the pick asked for it', () => {
    const args = createFieldsOf(
      sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: true }),
    )
    expect(args).toEqual({ model: 'anthropic/claude-opus-5-5', effort: 'high', fast: true })
    expect('accountId' in args).toBe(false)
  })
})
