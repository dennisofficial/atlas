import { describe, expect, it } from 'bun:test'

import { EHeldOutcome, settleWrite } from '../held-outcome'

describe('settleWrite', () => {
  it('writes nothing for a fenced session whatever it needed', () => {
    for (const needsHolder of [true, false]) {
      expect(settleWrite({ kind: EHeldOutcome.Fenced, needsHolder })).toEqual({ kind: 'none' })
    }
  })

  it('hands an idle or drained session back with the holder need it ended with', () => {
    for (const kind of [EHeldOutcome.Idle, EHeldOutcome.Drained]) {
      for (const needsHolder of [true, false]) {
        expect(settleWrite({ kind, needsHolder })).toEqual({
          kind: 'revoke',
          wantsHolder: needsHolder,
          resetRetry: true,
          retryDue: false,
        })
      }
    }
  })

  it('keeps the retry state of a session that failed to start or faulted and asks for a holder', () => {
    for (const kind of [EHeldOutcome.StartFailed, EHeldOutcome.Faulted]) {
      for (const needsHolder of [true, false]) {
        expect(settleWrite({ kind, needsHolder })).toEqual({
          kind: 'revoke',
          wantsHolder: true,
          resetRetry: false,
          retryDue: true,
        })
      }
    }
  })

  it('resets the retry state of a session that gave up and asks for no holder', () => {
    for (const needsHolder of [true, false]) {
      expect(settleWrite({ kind: EHeldOutcome.GaveUp, needsHolder })).toEqual({
        kind: 'revoke',
        wantsHolder: false,
        resetRetry: true,
        retryDue: false,
      })
    }
  })
})
