import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../../agents/status'
import { ERunFailureKind } from '../../events/run-failure'
import { repairHoldsResume } from '../repair-resume'
import {
  agentEnded,
  agentSpawned,
  CHILD,
  credentialWait,
  failureOf,
  MAIN,
  modelWaitCleared,
  modelWaiting,
  runFailed,
  turnStarted,
  userSaid,
} from './repair-fixtures'

describe('repairHoldsResume', () => {
  it('holds the main thread after a repairable run failure', () => {
    expect(repairHoldsResume({ mainThreadId: MAIN, events: [runFailed(failureOf())] })).toBe(true)
  })

  it('holds the main thread after a credential wait that has not cleared', () => {
    const events = [modelWaiting(credentialWait())]

    expect(repairHoldsResume({ mainThreadId: MAIN, events })).toBe(true)
  })

  it('releases the main thread once the credential wait clears', () => {
    const events = [modelWaiting(credentialWait()), modelWaitCleared(credentialWait().episode)]

    expect(repairHoldsResume({ mainThreadId: MAIN, events })).toBe(false)
  })

  it('releases the main thread once it starts a turn', () => {
    const events = [runFailed(failureOf()), turnStarted()]

    expect(repairHoldsResume({ mainThreadId: MAIN, events })).toBe(false)
  })

  it('releases the main thread once the operator says something', () => {
    const events = [runFailed(failureOf()), userSaid()]

    expect(repairHoldsResume({ mainThreadId: MAIN, events })).toBe(false)
  })

  it('does not hold the main thread for a failure with no repair', () => {
    const events = [runFailed(failureOf({ kind: ERunFailureKind.Network }))]

    expect(repairHoldsResume({ mainThreadId: MAIN, events })).toBe(false)
  })

  it('does not hold the main thread for a sub-agent that failed', () => {
    const events = [
      runFailed(failureOf(), CHILD),
      agentEnded({ status: EAgentStatus.Failed, failure: failureOf() }),
    ]

    expect(repairHoldsResume({ mainThreadId: MAIN, events })).toBe(false)
  })

  it('holds a sub-agent that failed on its own thread', () => {
    const events = [agentSpawned(), runFailed(failureOf(), CHILD)]

    expect(repairHoldsResume({ mainThreadId: CHILD, events })).toBe(true)
  })

  it('releases a sub-agent once its turn starts again', () => {
    const events = [agentSpawned(), runFailed(failureOf(), CHILD), turnStarted(CHILD)]

    expect(repairHoldsResume({ mainThreadId: CHILD, events })).toBe(false)
  })
})
