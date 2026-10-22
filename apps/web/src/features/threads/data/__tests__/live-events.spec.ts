import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { appendEvents, headOf, keepThrough } from '../live-events'

const event = (seq: number, body = 'a'): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'user-said',
  body,
})

describe('headOf', () => {
  it('is 0 for no events and the highest seq otherwise', () => {
    expect(headOf([])).toBe(0)
    expect(headOf([event(3), event(7), event(5)])).toBe(7)
  })
})

describe('appendEvents', () => {
  it('appends new events in seq order', () => {
    const next = appendEvents({ current: [event(1), event(2)], incoming: [event(4), event(3)] })
    expect(next.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])
  })

  it('lets the incoming event win on a repeated seq', () => {
    const next = appendEvents({ current: [event(1, 'old')], incoming: [event(1, 'new')] })
    expect(next.map((entry) => entry.body)).toEqual(['new'])
  })

  it('returns the same array when nothing is incoming', () => {
    const current = [event(1)]
    expect(appendEvents({ current, incoming: [] })).toBe(current)
  })
})

describe('keepThrough', () => {
  it('drops everything after the given seq', () => {
    const kept = keepThrough({ events: [event(1), event(2), event(3)], seq: 2 })
    expect(kept.map((entry) => entry.seq)).toEqual([1, 2])
  })
})
