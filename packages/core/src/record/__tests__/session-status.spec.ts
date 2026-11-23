import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../events/ids'
import { ERunFailureKind } from '../../events/run-failure'
import { chainEvents } from '../chain-events'
import type { V2Body } from '../event'
import { ESessionStatus } from '../session-status'
import { ETurnEndedBy, ETurnOutcome } from '../turns'
import {
  ENDED_AT,
  NOW,
  runFailed,
  STARTED_AT,
  branchesObserved,
  contextLoaded,
  otherFact,
  pullRequestLinked,
  statusOf,
  subscriptionEnded,
  toolDispatched,
  turnEnded,
  turnStarted,
  unknownFact,
  userSaid,
  worktreeEntered,
} from './status-fixtures'

describe('the turn boundary decides whether a turn is open', () => {
  it('reports idle when there are no events yet', () => {
    expect(statusOf({})).toEqual({ state: ESessionStatus.Idle, since: undefined })
  })

  it('reads a legacy log with activity but no turn events as idle', () => {
    const result = statusOf({ events: [userSaid(), toolDispatched()], live: true })
    expect(result).toEqual({ state: ESessionStatus.Idle, since: NOW })
  })

  it('reads a legacy finished turn as idle', () => {
    expect(statusOf({ events: [userSaid(), userSaid()], live: true }).state).toBe(
      ESessionStatus.Idle,
    )
  })

  it('reports thinking while a turn is open under a live lease', () => {
    expect(statusOf({ events: [turnStarted(), userSaid()], live: true })).toEqual({
      state: ESessionStatus.Thinking,
      since: NOW,
    })
  })

  it('reports resuming on an open turn with no live lease', () => {
    expect(statusOf({ events: [turnStarted(), userSaid()], live: false })).toEqual({
      state: ESessionStatus.Resuming,
      since: NOW,
    })
  })

  it('dates an open turn from its start when no activity followed', () => {
    expect(statusOf({ events: [turnStarted(), turnEnded(), turnStarted()], live: true })).toEqual({
      state: ESessionStatus.Thinking,
      since: STARTED_AT,
    })
  })

  it('reports idle once the turn ended, dated from the end', () => {
    expect(statusOf({ events: [turnStarted(), userSaid(), turnEnded()], live: true })).toEqual({
      state: ESessionStatus.Idle,
      since: ENDED_AT,
    })
  })

  it('reports idle with the end time when the operator stopped the turn', () => {
    const ended = turnEnded({ outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator })
    expect(statusOf({ events: [turnStarted(), userSaid(), ended], live: true })).toEqual({
      state: ESessionStatus.Idle,
      since: ENDED_AT,
    })
  })

  it('keeps a run failure after the turn ends as failed', () => {
    const ended = turnEnded({ outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Host })
    const events = [turnStarted(), userSaid(), runFailed(), ended]
    expect(statusOf({ events, live: true }).state).toBe(ESessionStatus.Failed)
  })

  it('starts a new turn after the previous one ended', () => {
    const result = statusOf({
      events: [
        turnStarted({ turnId: 'a' }),
        userSaid(),
        turnEnded({ turnId: 'a' }),
        turnStarted({ turnId: 'b' }),
        userSaid(),
      ],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('ignores a turn end for another turn id', () => {
    const result = statusOf({
      events: [turnStarted({ turnId: 'a' }), userSaid(), turnEnded({ turnId: 'b' })],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })
})

describe('a failure that a credential repair can fix asks the operator', () => {
  const failedEnd = turnEnded({ outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Host })

  it('reports an auth failure as waiting for credentials', () => {
    const events = [turnStarted(), userSaid(), runFailed({ kind: ERunFailureKind.Auth }), failedEnd]
    expect(statusOf({ events, live: true })).toEqual({
      state: ESessionStatus.WaitingForCredentials,
      reason: ERunFailureKind.Auth,
      since: NOW,
    })
  })

  it('keeps a failure no repair can fix as failed', () => {
    const events = [
      turnStarted(),
      userSaid(),
      runFailed({ kind: ERunFailureKind.Network }),
      failedEnd,
    ]
    expect(statusOf({ events, live: true })).toEqual({
      state: ESessionStatus.Failed,
      reason: 'connection reset',
      since: NOW,
    })
  })

  it('leaves the waiting state once a new turn carries a message', () => {
    const events = [
      turnStarted({ turnId: 'a' }),
      userSaid(),
      runFailed({ kind: ERunFailureKind.Auth }),
      failedEnd,
      turnStarted({ turnId: 'b' }),
      userSaid(),
    ]
    expect(statusOf({ events, live: true }).state).toBe(ESessionStatus.Thinking)
  })
})

describe('bookkeeping events never move the turn', () => {
  const trailing = [
    subscriptionEnded(),
    contextLoaded(),
    worktreeEntered(),
    branchesObserved(),
    pullRequestLinked(),
    otherFact(),
    unknownFact(),
  ]

  it('keeps the open turn through every bookkeeping event', () => {
    const result = statusOf({ events: [turnStarted(), userSaid(), ...trailing], live: true })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('keeps running-tool through bookkeeping that trails a dispatch', () => {
    const result = statusOf({
      events: [turnStarted(), toolDispatched({ name: 'bash' }), ...trailing],
      live: true,
    })
    expect(result).toEqual({ state: ESessionStatus.RunningTool, reason: 'bash', since: NOW })
  })

  it('reports idle once the turn ended, whatever follows', () => {
    const result = statusOf({ events: [turnStarted(), userSaid(), turnEnded(), ...trailing] })
    expect(result).toEqual({ state: ESessionStatus.Idle, since: ENDED_AT })
  })
})

describe('sessionStatusOf workspace preparation', () => {
  const chained = (bodies: V2Body[], messageAfterFailure = false): ReturnType<typeof statusOf> => {
    const events = chainEvents({
      threadId: toThreadId('t'),
      runId: toRunId('r'),
      epoch: 1,
      at: NOW,
      bodies,
    })
    return statusOf({ events, live: true, messageAfterFailure })
  }

  it('reports preparing for a new session', () => {
    expect(statusOf({}).state).toBe(ESessionStatus.Idle)
    expect(chained([]).state).toBe(ESessionStatus.Preparing)
  })

  it('reports setup-failed with the reason until a message arrives', () => {
    const failed: V2Body = {
      type: 'workspace-prepare-failed',
      reason: 'clone failed',
      inboxHead: 1,
    }
    expect(chained([failed])).toEqual({
      state: ESessionStatus.SetupFailed,
      reason: 'clone failed',
      since: NOW,
    })
    expect(chained([failed], true).state).toBe(ESessionStatus.Preparing)
  })

  it('leaves a prepared session to the turn rules', () => {
    expect(chained([{ type: 'workspace-prepared' }]).state).toBe(ESessionStatus.Idle)
    expect(statusOf({ events: [turnStarted(), userSaid()], live: true }).state).toBe(
      ESessionStatus.Thinking,
    )
  })
})
