import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '../session-status'
import { ETurnEndedBy, ETurnOutcome } from '../turns'
import {
  ENDED_AT,
  NOW,
  STARTED_AT,
  branchesObserved,
  statusOf,
  toolDispatched,
  turnEnded,
  turnStarted,
  userSaid,
} from './status-fixtures'

describe('the time the current status was entered', () => {
  it('dates an open turn from the activity that set its label', () => {
    const status = statusOf({ events: [turnStarted(), userSaid(), toolDispatched()], live: true })
    expect(status).toEqual({ state: ESessionStatus.RunningTool, reason: 'bash', since: NOW })
  })

  it('falls back to the turn start while the turn recorded no label', () => {
    const status = statusOf({ events: [turnStarted(), turnEnded(), turnStarted()], live: true })
    expect(status).toEqual({ state: ESessionStatus.Thinking, since: STARTED_AT })
  })

  it('moves to the moment an operator stopped the turn', () => {
    const ended = turnEnded({ outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator })
    const status = statusOf({
      events: [turnStarted(), userSaid(), toolDispatched(), ended],
      live: true,
    })
    expect(status).toEqual({ state: ESessionStatus.Idle, since: ENDED_AT })
  })

  it('moves to the moment the turn ended for the agent', () => {
    const status = statusOf({ events: [turnStarted(), userSaid(), turnEnded()], live: true })
    expect(status).toEqual({ state: ESessionStatus.Idle, since: ENDED_AT })
  })

  it('dates a legacy idle session from its last activity', () => {
    const status = statusOf({ events: [userSaid(), branchesObserved()], live: true })
    expect(status).toEqual({ state: ESessionStatus.Idle, since: NOW })
  })
})
