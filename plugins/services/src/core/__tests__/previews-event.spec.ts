import { describe, expect, it } from 'bun:test'

import { isTurnTakingType, type RecordEvent } from '@dltech/atlas-core'

import { hasPreviewsReady, latestPreviewsReadyAt, previewsReadySchema } from '../previews-event'

const ready = (n: number): RecordEvent =>
  ({
    type: 'previews-ready',
    at: `at-${n}`,
    seq: n,
    id: `e${n}`,
    threadId: 't1',
  }) as unknown as RecordEvent

describe('latestPreviewsReadyAt', () => {
  it('reports the newest tunnel registration the journal holds', () => {
    expect(latestPreviewsReadyAt([ready(1), ready(2)])).toBe('at-2')
  })

  it('reports nothing when the tunnel never registered', () => {
    expect(latestPreviewsReadyAt([])).toBeUndefined()
  })
})

describe('hasPreviewsReady', () => {
  it('matches one registration, not another', () => {
    expect(hasPreviewsReady({ events: [ready(1)], at: 'at-1' })).toBe(true)
    expect(hasPreviewsReady({ events: [ready(1)], at: 'at-2' })).toBe(false)
  })
})

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
