import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import { isSessionWorking, isTurnRunning } from '../session-state'

const statusOf = (state: ESessionStatus) => ({
  state,
  lease: { epoch: 1, holderHostId: 1, live: true },
})

describe('isTurnRunning', () => {
  it('keeps the session working but opens no turn while summarise runs', () => {
    const status = { ...statusOf(ESessionStatus.RunningCommand), reason: 'summarise' }
    expect({ working: isSessionWorking(status), turn: isTurnRunning(status) }).toEqual({
      working: true,
      turn: false,
    })
  })

  for (const state of [ESessionStatus.Queued, ESessionStatus.Thinking, ESessionStatus.RunningTool])
    it(`reads ${state} as a running turn`, () => {
      expect(isTurnRunning(statusOf(state))).toBe(true)
    })

  for (const state of [ESessionStatus.Idle, ESessionStatus.WaitingForOperator])
    it(`reads ${state} as neither working nor a turn`, () => {
      expect([isSessionWorking(statusOf(state)), isTurnRunning(statusOf(state))]).toEqual([
        false,
        false,
      ])
    })

  it('reads a missing status as idle', () => {
    expect([isSessionWorking(undefined), isTurnRunning(undefined)]).toEqual([false, false])
  })
})
