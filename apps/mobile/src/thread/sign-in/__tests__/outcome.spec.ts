import { describe, expect, it } from 'bun:test'

import { EReturnResult } from '@dltech/atlas-core'

import { signInDurableOutcomeOf } from '../outcome'

describe('the result the roster already knows', () => {
  it('says nothing while the card is pending', () => {
    expect(signInDurableOutcomeOf({ result: undefined, reason: undefined })).toBeUndefined()
  })

  it('reads a connected sign-in', () => {
    expect(signInDurableOutcomeOf({ result: 'connected', reason: undefined })).toEqual({
      result: EReturnResult.Connected,
    })
  })

  it('keeps the reason of a refusal', () => {
    expect(signInDurableOutcomeOf({ result: 'failed', reason: 'the provider refused' })).toEqual({
      result: EReturnResult.Failed,
      reason: 'the provider refused',
    })
  })

  it('shows a refusal that carries no reason', () => {
    expect(signInDurableOutcomeOf({ result: 'failed', reason: undefined })).toEqual({
      result: EReturnResult.Failed,
    })
  })
})
