import { describe, expect, it } from 'bun:test'

import { ESessionStatus, isSettledStatus } from '../session-status'

const SETTLED = [
  ESessionStatus.Idle,
  ESessionStatus.SetupFailed,
  ESessionStatus.StartFailed,
  ESessionStatus.Failed,
] as const

const WORKING = [
  ESessionStatus.Preparing,
  ESessionStatus.Queued,
  ESessionStatus.Thinking,
  ESessionStatus.RunningTool,
  ESessionStatus.RunningCommand,
  ESessionStatus.WaitingToRetry,
  ESessionStatus.WaitingForCredentials,
  ESessionStatus.WaitingForOperator,
  ESessionStatus.Resuming,
  ESessionStatus.WaitingForBackground,
] as const

describe('isSettledStatus', () => {
  for (const state of SETTLED)
    it(`counts ${state} as settled`, () => {
      expect(isSettledStatus(state)).toBe(true)
    })

  for (const state of WORKING)
    it(`counts ${state} as working`, () => {
      expect(isSettledStatus(state)).toBe(false)
    })

  it('covers every session status, so a new one has to choose a side', () => {
    const named = [...SETTLED, ...WORKING].sort()
    expect(named).toEqual(Object.values(ESessionStatus).sort())
  })
})
