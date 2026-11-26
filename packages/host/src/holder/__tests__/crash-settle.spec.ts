import { describe, expect, it } from 'bun:test'

import { ECrashedCall } from '@dltech/atlas-agent'

import { crashSettleOf } from '../crash-settle'

describe('crashSettleOf', () => {
  it('holds every crashed call, daemon or host effect, so the loop replays its recorded steps', () => {
    expect(crashSettleOf()).toBe(ECrashedCall.Hold)
  })
})
