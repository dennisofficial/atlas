import { describe, expect, it } from 'bun:test'

import { ERewindDisposition, REWIND_DISPOSITION, rewindDisposition } from '../rewind-disposition'

const typesWith = (disposition: ERewindDisposition): string[] =>
  Object.entries(REWIND_DISPOSITION)
    .filter(([, value]) => value === disposition)
    .map(([type]) => type)
    .sort()

describe('rewindDisposition', () => {
  it('keeps the notices of things that happened outside the conversation', () => {
    expect(typesWith(ERewindDisposition.Keep)).toEqual([
      'checkout-observed',
      'location-changed',
      'model-wait-cleared',
      'model-waiting',
      'pr-event',
    ])
  })

  it('ties process endings to whether their creator was cut', () => {
    expect(typesWith(ERewindDisposition.KeepUnlessCreatorCut)).toEqual([
      'agent-ended',
      'background-shell-awaiting-input',
      'background-shell-ended',
      'background-shell-matched',
      'background-shell-still-running',
      'service-ended',
    ])
  })

  it('discards conversation turns and the creations a cut destroys', () => {
    expect(rewindDisposition('user-said')).toBe(ERewindDisposition.Discard)
    expect(rewindDisposition('agent-spawned')).toBe(ERewindDisposition.Discard)
    expect(rewindDisposition('background-shell-started')).toBe(ERewindDisposition.Discard)
  })
})
