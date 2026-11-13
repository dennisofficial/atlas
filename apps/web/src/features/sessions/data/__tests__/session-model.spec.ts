import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-ui/ai/model-selector'

import { createFieldsOf } from '@/features/threads/data/model-selection'

import { sessionModelOf, sessionSelectionOf } from '../session-model'

describe('sessionModelOf', () => {
  it('reads the pinned model off a session row', () => {
    expect(sessionModelOf({ model: { ref: 'anthropic/opus', effort: 'high' } })).toEqual({
      ref: 'anthropic/opus',
      effort: 'high',
    })
  })

  it('reads a session that pins nothing', () => {
    expect(sessionModelOf({ model: null })).toBeNull()
    expect(sessionModelOf({})).toBeNull()
    expect(sessionModelOf(undefined)).toBeNull()
  })
})

describe('sessionSelectionOf', () => {
  it('uses the plain model ref as the selection id so pinned favourites match', () => {
    expect(sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'high' })).toEqual({
      id: 'anthropic/claude-opus-5-5',
      effort: EEffort.High,
      fast: false,
    })
  })

  it('carries the fast flag', () => {
    expect(
      sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'low', fast: true }),
    ).toEqual({ id: 'anthropic/claude-opus-5-5', effort: EEffort.Low, fast: true })
  })

  it('falls back to the default effort for a session that pinned none', () => {
    expect(sessionSelectionOf({ ref: 'openai/gpt-5' }).effort).toBe(EEffort.Medium)
  })

  it('falls back to an unset selection for a session without a pinned model', () => {
    expect(sessionSelectionOf(null).id).toBe('')
    expect(sessionSelectionOf(undefined).id).toBe('')
  })
})

describe('model-set args of a session selection', () => {
  it('sends the plain ref and the effort, with no account', () => {
    const args = createFieldsOf(
      sessionSelectionOf({ ref: 'anthropic/claude-opus-5-5', effort: 'high' }),
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
