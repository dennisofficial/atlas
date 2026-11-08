import { describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { sessionRefusalsOf } from '../session-refusals'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const refused = (inboxId: number, reason: string): V2Body => ({
  type: 'input-refused',
  inboxId,
  reason,
})

describe('sessionRefusalsOf', () => {
  it('lists refusals in event order, newest last', () => {
    const events = eventsOf([
      refused(1, 'first'),
      { type: 'user-said', text: 'a' },
      refused(2, 'second'),
    ])
    expect(sessionRefusalsOf(events)).toEqual([
      { inboxId: 1, reason: 'first' },
      { inboxId: 2, reason: 'second' },
    ])
  })

  it('keeps only the last twenty', () => {
    const events = eventsOf(
      Array.from({ length: 25 }, (_, index) => refused(index + 1, `r${index + 1}`)),
    )
    const refusals = sessionRefusalsOf(events)
    expect(refusals).toHaveLength(20)
    expect(refusals[0]).toEqual({ inboxId: 6, reason: 'r6' })
    expect(refusals.at(-1)).toEqual({ inboxId: 25, reason: 'r25' })
  })

  it('honours an explicit limit', () => {
    const events = eventsOf([refused(1, 'a'), refused(2, 'b'), refused(3, 'c')])
    expect(sessionRefusalsOf(events, 2).map((refusal) => refusal.inboxId)).toEqual([2, 3])
  })

  it('skips an empty reason', () => {
    expect(sessionRefusalsOf(eventsOf([refused(1, ''), refused(2, 'why')]))).toEqual([
      { inboxId: 2, reason: 'why' },
    ])
  })

  it('ignores events that are not refusals', () => {
    const events = eventsOf([
      { type: 'user-said', text: 'a' },
      { type: 'input-consumed', inboxId: 1 },
    ])
    expect(sessionRefusalsOf(events)).toEqual([])
  })
})
