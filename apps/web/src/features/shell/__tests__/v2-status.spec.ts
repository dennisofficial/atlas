import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import { EThreadStatus } from '../thread-status'
import { type V2RowView, v2IsUnread, v2StatusIconOf } from '../v2-status'

const EXPECTED: Record<ESessionStatus, EThreadStatus> = {
  [ESessionStatus.Failed]: EThreadStatus.Failed,
  [ESessionStatus.SetupFailed]: EThreadStatus.Failed,
  [ESessionStatus.StartFailed]: EThreadStatus.Failed,
  [ESessionStatus.WaitingForCredentials]: EThreadStatus.Awaiting,
  [ESessionStatus.WaitingForOperator]: EThreadStatus.Awaiting,
  [ESessionStatus.Preparing]: EThreadStatus.Starting,
  [ESessionStatus.Queued]: EThreadStatus.Idle,
  [ESessionStatus.Thinking]: EThreadStatus.Running,
  [ESessionStatus.RunningTool]: EThreadStatus.Running,
  [ESessionStatus.WaitingForBackground]: EThreadStatus.Running,
  [ESessionStatus.WaitingToRetry]: EThreadStatus.Running,
  [ESessionStatus.Resuming]: EThreadStatus.Running,
  [ESessionStatus.Idle]: EThreadStatus.Idle,
}

describe('v2StatusIconOf', () => {
  for (const status of Object.values(ESessionStatus)) {
    it(`maps ${status}`, () => {
      expect(v2StatusIconOf(status)).toBe(EXPECTED[status])
    })
  }

  it('has no icon when the row carries no status', () => {
    expect(v2StatusIconOf(undefined)).toBeUndefined()
  })
})

const view = (overrides: Partial<V2RowView> = {}): V2RowView => ({
  status: undefined,
  branch: undefined,
  pullRequest: undefined,
  routineId: undefined,
  lastAssistantSeq: 5,
  readSeq: null,
  ...overrides,
})

describe('v2IsUnread', () => {
  it('marks a row unread when the assistant spoke past the cursor', () => {
    expect(v2IsUnread({ view: view(), active: false })).toBe(true)
    expect(v2IsUnread({ view: view({ readSeq: 4 }), active: false })).toBe(true)
    expect(v2IsUnread({ view: view({ readSeq: 5 }), active: false })).toBe(false)
  })

  it('never marks the active row or a row with no assistant output', () => {
    expect(v2IsUnread({ view: view(), active: true })).toBe(false)
    expect(v2IsUnread({ view: view({ lastAssistantSeq: 0 }), active: false })).toBe(false)
  })

  it('suppresses the dot while the session works, but not while it awaits', () => {
    expect(v2IsUnread({ view: view({ status: ESessionStatus.Thinking }), active: false })).toBe(
      false,
    )
    expect(
      v2IsUnread({ view: view({ status: ESessionStatus.WaitingForOperator }), active: false }),
    ).toBe(true)
  })
})
