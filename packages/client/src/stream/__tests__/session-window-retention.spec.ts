import { describe, expect, it } from 'bun:test'
import { ERunFailureKind, recordEventSchema, type RecordEventBody } from '@dltech/atlas-core'

import { RENDER_LIMIT } from '../session-window'
import { answersOf, windowOf } from './retention-answers'
import { EPISODES, logOf } from './retention-log-fixture'
import { mintEvents } from './support'

describe('a retained tail answers like the whole log', () => {
  const events = logOf(EPISODES)
  const whole = answersOf(events)
  const cuts = Array.from(
    { length: 20 },
    (_, index) => (index + 1) * Math.floor(events.length / 20),
  )

  it('reads every event the fixture builds', () => {
    const unreadable = events
      .filter((event) => !recordEventSchema.safeParse({ ...event }).success)
      .map((event) => event.type)
    expect([...new Set(unreadable)]).toEqual([])
  })

  for (const cut of cuts) {
    it(`agrees at cut ${cut}`, () => {
      const prefix = events.slice(0, cut)
      const pageSize = 37
      const window = windowOf({ events: prefix, pageSize })
      expect(answersOf(window.foldable)).toEqual(answersOf(prefix))
    })
  }

  it('agrees when the whole log is applied in one page', () => {
    expect(answersOf(windowOf({ events, pageSize: events.length }).foldable)).toEqual(whole)
  })

  it('keeps the tail small', () => {
    const window = windowOf({ events, pageSize: 37 })
    expect(window.events.length).toBeLessThanOrEqual(RENDER_LIMIT)
    expect(window.durable.length).toBeLessThan(200)
  })

  it('keeps the same durable and foldable at every page size', () => {
    const first = windowOf({ events, pageSize: 1 })
    for (const pageSize of [7, 200, events.length]) {
      const window = windowOf({ events, pageSize })
      expect(window.durable.map((event) => event.seq)).toEqual(
        first.durable.map((event) => event.seq),
      )
      expect(window.foldable.map((event) => event.seq)).toEqual(
        first.foldable.map((event) => event.seq),
      )
    }
  })
})

describe('a superseding message that leaves the window', () => {
  const padding = (count: number): RecordEventBody[] =>
    Array.from(
      { length: count },
      (): RecordEventBody => ({
        type: 'context-changed',
        paths: ['pad.md'],
      }),
    )

  const events = mintEvents({
    bodies: [
      { type: 'run-failed', failure: { kind: ERunFailureKind.Auth, message: 'signed out' } },
      { type: 'user-said', text: 'retry' },
      ...padding(201),
    ],
  })

  it('clears the failure whether the log arrives in one page or one event at a time', () => {
    const whole = answersOf(windowOf({ events, pageSize: events.length }).foldable)
    const single = answersOf(windowOf({ events, pageSize: 1 }).foldable)
    expect(whole.failures).toEqual([])
    expect(single.failures).toEqual([])
  })

  it('keeps the same durable as a single page', () => {
    const whole = windowOf({ events, pageSize: events.length })
    const single = windowOf({ events, pageSize: 1 })
    expect(single.durable.map((event) => event.seq)).toEqual(
      whole.durable.map((event) => event.seq),
    )
  })
})
