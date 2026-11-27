import { describe, expect, it } from 'bun:test'

import { isTurnTakingType } from '@dltech/atlas-core'

import { previewsReadySchema } from '../previews-event'

describe('previewsReadySchema', () => {
  it('accepts a registration and rejects a missing time', () => {
    expect(previewsReadySchema.safeParse({ type: 'previews-ready', at: 'at-1' }).success).toBe(true)
    expect(previewsReadySchema.safeParse({ type: 'previews-ready' }).success).toBe(false)
  })
})

describe('a preview tunnel registration', () => {
  it('never hands the turn to the assistant', () => {
    expect(isTurnTakingType('previews-ready')).toBe(false)
  })
})
