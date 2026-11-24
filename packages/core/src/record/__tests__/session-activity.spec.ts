import { describe, expect, it } from 'bun:test'

import { ESessionActivity, ESessionStatus, sessionActivityOf } from '../session-status'

const EXPECTED: ReadonlyArray<readonly [ESessionStatus, ESessionActivity]> = [
  [ESessionStatus.Preparing, ESessionActivity.Setup],
  [ESessionStatus.Queued, ESessionActivity.Turn],
  [ESessionStatus.Thinking, ESessionActivity.Turn],
  [ESessionStatus.RunningTool, ESessionActivity.Turn],
  [ESessionStatus.WaitingToRetry, ESessionActivity.Turn],
  [ESessionStatus.Resuming, ESessionActivity.Turn],
  [ESessionStatus.RunningCommand, ESessionActivity.Command],
  [ESessionStatus.WaitingForCredentials, ESessionActivity.Waiting],
  [ESessionStatus.WaitingForOperator, ESessionActivity.Waiting],
  [ESessionStatus.WaitingForBackground, ESessionActivity.Waiting],
  [ESessionStatus.Idle, ESessionActivity.Settled],
  [ESessionStatus.SetupFailed, ESessionActivity.Settled],
  [ESessionStatus.StartFailed, ESessionActivity.Settled],
  [ESessionStatus.Failed, ESessionActivity.Settled],
]

describe('sessionActivityOf', () => {
  for (const [state, activity] of EXPECTED)
    it(`reads ${state} as ${activity}`, () => {
      expect(sessionActivityOf(state)).toBe(activity)
    })

  it('reads a running command such as summarise as no turn', () => {
    expect(sessionActivityOf(ESessionStatus.RunningCommand)).not.toBe(ESessionActivity.Turn)
  })
})
