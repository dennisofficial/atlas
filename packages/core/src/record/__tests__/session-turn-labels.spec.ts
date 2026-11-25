import { describe, expect, it } from 'bun:test'

import { EFinishReason } from '../../stream/chunk'
import type { RecordEvent } from '../event'
import { ESessionStatus } from '../session-status'
import { ETurnEndedBy, ETurnOutcome } from '../turns'
import {
  assistantSaid,
  dismissFailure,
  inputConsumed,
  modelWaiting,
  otherFact,
  retry,
  retryLikeFact,
  runFailed,
  statusOf,
  toolCalled,
  toolDenied,
  toolDispatched,
  toolParked,
  toolResult,
  turnEnded,
  turnStarted,
  userSaid,
  waitCleared,
} from './status-fixtures'

const open = (...events: readonly RecordEvent[]) =>
  statusOf({ events: [turnStarted(), ...events], live: true })

describe('the label inside an open turn', () => {
  it('reports running-tool while a dispatched tool has no result', () => {
    expect(open(userSaid(), toolDispatched({ name: 'bash' }))).toEqual({
      state: ESessionStatus.RunningTool,
      reason: 'bash',
      since: toolDispatched().at,
    })
  })

  it('returns to thinking once the tool result lands', () => {
    expect(open(toolDispatched(), toolResult()).state).toBe(ESessionStatus.Thinking)
  })

  it('reports thinking on a prepared call and on a denied call', () => {
    expect(open(toolCalled()).state).toBe(ESessionStatus.Thinking)
    expect(open(toolDenied()).state).toBe(ESessionStatus.Thinking)
  })

  it('reports thinking while the model composes a reply', () => {
    expect(open(userSaid(), assistantSaid({ finish: EFinishReason.ToolCalls }))).toEqual({
      state: ESessionStatus.Thinking,
      since: assistantSaid().at,
    })
  })

  it('reports waiting-for-operator from a parked call', () => {
    const result = open(userSaid(), toolParked())
    expect(result.state).toBe(ESessionStatus.WaitingForOperator)
    expect(result.reason).toBe('bash')
  })

  it('reports waiting-to-retry on a retry with a future deadline', () => {
    const result = open(userSaid(), retry({ notBefore: '2026-11-03T12:00:12.000Z' }))
    expect(result.state).toBe(ESessionStatus.WaitingToRetry)
    expect(result.reason).toContain('12:00:12')
  })

  it('ignores a retry whose deadline has passed', () => {
    const result = open(userSaid(), retry({ notBefore: '2026-11-03T11:00:00.000Z' }))
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('does not count a fact-recorded with a retry-like key', () => {
    const result = open(userSaid(), retryLikeFact({ notBefore: '2026-11-03T12:00:12.000Z' }))
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('reports waiting-for-credentials on an open credential wait', () => {
    const result = open(userSaid(), modelWaiting({ reason: 'auth' }))
    expect(result.state).toBe(ESessionStatus.WaitingForCredentials)
    expect(result.reason).toBe('auth')
  })

  it('clears waiting-for-credentials once the wait is cleared', () => {
    const waiting = modelWaiting()
    const cleared = waitCleared(waiting as Extract<typeof waiting, { type: 'model-waiting' }>)
    expect(open(waiting, cleared, assistantSaid()).state).toBe(ESessionStatus.Thinking)
  })

  it('reports resuming when the open turn has no live lease', () => {
    expect(statusOf({ events: [turnStarted(), userSaid()], live: false })).toEqual({
      state: ESessionStatus.Resuming,
      since: userSaid().at,
    })
  })
})

describe('failures inside and after a turn', () => {
  it('reports failed on an unfinished run-failed', () => {
    expect(open(userSaid(), runFailed({ message: 'connection reset' }))).toEqual({
      state: ESessionStatus.Failed,
      reason: 'connection reset',
      since: runFailed().at,
    })
  })

  it('stays failed after a failed turn ends', () => {
    const ended = turnEnded({ outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Agent })
    const result = statusOf({ events: [turnStarted(), userSaid(), runFailed(), ended], live: true })
    expect(result.state).toBe(ESessionStatus.Failed)
  })

  it('keeps failed when record-only events follow the failure', () => {
    expect(open(userSaid(), runFailed(), otherFact()).state).toBe(ESessionStatus.Failed)
  })

  it('treats a dismissed failure as failed only when no turn restarted', () => {
    const failed = runFailed({ message: 'boom' })
    expect(open(failed, dismissFailure(failed)).state).toBe(ESessionStatus.Failed)
    expect(open(failed, dismissFailure(failed), userSaid()).state).toBe(ESessionStatus.Thinking)
  })

  it('leaves a legacy failure failed without any turn events', () => {
    const result = statusOf({ events: [userSaid(), runFailed()] })
    expect(result.state).toBe(ESessionStatus.Failed)
  })
})

describe('inbox entries inside a turn', () => {
  it('stays thinking when a malformed entry is discarded after a tool result', () => {
    expect(open(toolDispatched(), toolResult(), inputConsumed()).state).toBe(
      ESessionStatus.Thinking,
    )
  })

  it('keeps running-tool while a fact follows the dispatch', () => {
    expect(open(toolDispatched(), otherFact()).state).toBe(ESessionStatus.RunningTool)
  })

  it('returns to thinking after an interrupted tool result', () => {
    expect(open(toolDispatched(), toolResult({ interrupted: true })).state).toBe(
      ESessionStatus.Thinking,
    )
  })

  it('keeps the turn open while a consumed stop waits for the turn end', () => {
    expect(open(userSaid(), inputConsumed()).state).toBe(ESessionStatus.Thinking)
  })
})
