import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { EPendingWork } from '../../notify/pending-work'
import type { Hash, V2Body, V2Event } from '../event'
import { ETurnCause, ETurnEndedBy, ETurnOutcome, openTurnOf, turnEndedSchema } from '../turns'

const HASH = 'a'.repeat(64) as Hash
const THREAD = toThreadId('t')
const RUN = toRunId('r')
const FIRST_AT = '2026-11-21T10:00:00.000Z'
const SECOND_AT = '2026-11-21T10:05:00.000Z'

const started = (turnId: string, cause: ETurnCause = ETurnCause.Input): V2Body => ({
  type: 'turn-started',
  turnId,
  cause,
})

const ended = (turnId: string, outcome: ETurnOutcome = ETurnOutcome.Completed): V2Body => ({
  type: 'turn-ended',
  turnId,
  outcome,
  by: ETurnEndedBy.Agent,
})

const reply: V2Body = { type: 'assistant-said', parts: [] }

const eventsOf = (bodies: readonly V2Body[], at = FIRST_AT): V2Event[] =>
  bodies.map(
    (body, index) =>
      ({
        ...body,
        id: toEventId(`t:${index + 1}`),
        seq: index + 1,
        threadId: THREAD,
        runId: RUN,
        depth: 0,
        at,
        epoch: 1,
        prevHash: HASH,
      }) as V2Event,
  )

describe('openTurnOf', () => {
  it('finds nothing in a log without turn events', () => {
    expect(openTurnOf(eventsOf([reply]))).toBeNull()
  })

  it('finds the turn a start opened', () => {
    expect(openTurnOf(eventsOf([started('a'), reply]))).toEqual({
      turnId: 'a',
      startedAt: FIRST_AT,
    })
  })

  it('finds nothing once the turn ended', () => {
    expect(openTurnOf(eventsOf([started('a'), reply, ended('a')]))).toBeNull()
  })

  it('finds the later of two sequential turns', () => {
    const first = eventsOf([started('a'), ended('a')])
    const second = eventsOf([started('b')], SECOND_AT)
    expect(openTurnOf([...first, ...second])).toEqual({ turnId: 'b', startedAt: SECOND_AT })
  })

  it('falls back to the outer turn once a nested turn ended', () => {
    expect(openTurnOf(eventsOf([started('outer'), started('inner'), ended('inner')]))).toEqual({
      turnId: 'outer',
      startedAt: FIRST_AT,
    })
  })

  it('keeps the turn open when the end names another turn', () => {
    expect(openTurnOf(eventsOf([started('a'), ended('b')]))).toEqual({
      turnId: 'a',
      startedAt: FIRST_AT,
    })
  })

  it('reopens the same turn id with the newer start time', () => {
    const first = eventsOf([started('a'), ended('a')])
    const resumed = eventsOf([started('a', ETurnCause.Resume)], SECOND_AT)
    expect(openTurnOf([...first, ...resumed])).toEqual({ turnId: 'a', startedAt: SECOND_AT })
  })
})

describe('turnEndedSchema', () => {
  it('parses a row recorded before the notify facts existed', () => {
    const parsed = turnEndedSchema.parse({
      type: 'turn-ended',
      turnId: 'a',
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
    })

    expect(parsed.notify).toBeUndefined()
  })

  it('parses the pending work and the operator turn recorded on the row', () => {
    const parsed = turnEndedSchema.parse({
      type: 'turn-ended',
      turnId: 'a',
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
      notify: { pending: [EPendingWork.Shell, EPendingWork.Subscription], operatorTurn: true },
    })

    expect(parsed.notify).toEqual({
      pending: [EPendingWork.Shell, EPendingWork.Subscription],
      operatorTurn: true,
    })
  })
})
