import { describe, expect, it } from 'bun:test'

import { ERunRemedy } from '@dltech/atlas-core'

import { activePendingOf, attentionKeyOf } from '../run-attention-pending'

const pending = { remedy: ERunRemedy.Retry as const, key: '3:none' }

describe('activePendingOf', () => {
  it('stays pending while idle on the same attention', () => {
    expect(activePendingOf({ pending, key: '3:none', working: false })).toBe(ERunRemedy.Retry)
  })

  it('clears once the run is working', () => {
    expect(activePendingOf({ pending, key: '3:none', working: true })).toBeNull()
  })

  it('clears when the attention identity changes or goes away', () => {
    expect(activePendingOf({ pending, key: '7:none', working: false })).toBeNull()
    expect(activePendingOf({ pending, key: null, working: false })).toBeNull()
  })

  it('keys an attention by failure seq and run', () => {
    expect(attentionKeyOf({ failureSeq: 3, runId: null })).toBe('3:none')
  })
})
