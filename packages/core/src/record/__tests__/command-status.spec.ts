import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '../session-status'
import {
  commandConsumed,
  commandPosted,
  commandRefused,
  ENDED_AT,
  NOW,
  STARTED_AT,
  statusOf,
  summarised,
  turnStarted,
} from './status-fixtures'

describe('a running command decides the session status', () => {
  it('reports the command by name while it runs', () => {
    expect(statusOf({ events: [commandPosted(), commandConsumed()], live: true })).toEqual({
      state: ESessionStatus.RunningCommand,
      reason: 'summarise',
      since: NOW,
    })
  })

  it('names a command from the kind it was posted with', () => {
    const events = [commandPosted({ name: 'rewind' }), commandConsumed()]
    expect(statusOf({ events, live: true }).reason).toBe('rewind')
  })

  it('names a command consumed in a log that never posted it', () => {
    expect(statusOf({ events: [commandConsumed({ name: 'summarise' })], live: true })).toEqual({
      state: ESessionStatus.RunningCommand,
      reason: 'summarise',
      since: NOW,
    })
  })

  it('keeps the open turn when a turn is running too', () => {
    const events = [commandPosted(), commandConsumed(), turnStarted()]
    expect(statusOf({ events, live: true }).state).toBe(ESessionStatus.Thinking)
  })

  it('keeps the command visible while a message waits behind it', () => {
    const events = [commandPosted(), commandConsumed()]
    expect(statusOf({ events, live: true, queuedSince: ENDED_AT }).state).toBe(
      ESessionStatus.RunningCommand,
    )
  })

  it('reports idle once the outcome lands', () => {
    const events = [commandPosted(), commandConsumed(), summarised()]
    expect(statusOf({ events, live: true })).toEqual({
      state: ESessionStatus.Idle,
      since: undefined,
    })
  })

  it('reports idle once the command is refused', () => {
    const events = [commandPosted(), commandConsumed(), commandRefused()]
    expect(statusOf({ events, live: true }).state).toBe(ESessionStatus.Idle)
  })

  it('ignores a command whose name never has an outcome', () => {
    const events = [commandPosted({ name: 'subscribe' }), commandConsumed()]
    expect(statusOf({ events, live: true }).state).toBe(ESessionStatus.Idle)
  })

  it('leaves a posted command that is not consumed alone', () => {
    expect(statusOf({ events: [commandPosted()], live: true })).toEqual({
      state: ESessionStatus.Idle,
      since: undefined,
    })
  })

  it('dates a command posted earlier from the moment it was consumed', () => {
    expect(statusOf({ events: [commandPosted(), commandConsumed()], live: true }).since).not.toBe(
      STARTED_AT,
    )
  })
})
