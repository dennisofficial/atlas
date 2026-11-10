import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../events/body'
import { planCompaction } from '../compaction-plan'
import { called, compacted, eventsFrom, replied, resulted, said } from './fixture'

const TEXT = 'x'.repeat(400)

const turn = (): readonly EventDraft[] => [said(TEXT), replied(TEXT)]

const turns = (count: number): readonly EventDraft[] => Array.from({ length: count }, turn).flat()

describe('planCompaction', () => {
  it('proposes the last turn boundary before everything it would cut', () => {
    const events = eventsFrom(turns(6))

    expect(planCompaction({ events })).toEqual({
      throughSeq: 10,
      compactedEvents: 10,
      keptEvents: 2,
    })
  })

  it('never bisects a turn, so the watermark always sits just before an operator message', () => {
    const events = eventsFrom(turns(8))
    const plan = planCompaction({ events })

    const nextEvent = events.find((event) => event.seq === (plan?.throughSeq ?? 0) + 1)
    expect(nextEvent?.type).toBe('user-said')
  })

  it('proposes nothing when the only untouched turn is the one in progress', () => {
    const events = eventsFrom(turns(1))

    expect(planCompaction({ events })).toBeUndefined()
  })

  it('advances past a watermark the thread already carries', () => {
    const events = eventsFrom([...turns(3), compacted(2, 'the first turn'), ...turns(3)])

    expect(planCompaction({ events })?.throughSeq).toBeGreaterThan(2)
  })

  it('refuses to propose a watermark the guard would reject', () => {
    const events = eventsFrom([
      said(TEXT),
      called('call-1'),
      said(TEXT),
      resulted('call-1'),
      replied(TEXT),
      said(TEXT),
      replied(TEXT),
    ])

    expect(planCompaction({ events })?.throughSeq).not.toBe(2)
  })
})
