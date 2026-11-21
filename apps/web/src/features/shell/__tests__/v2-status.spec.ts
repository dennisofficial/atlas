import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus } from '@dltech/atlas-protocol'

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
      expect(v2StatusIconOf(view({ status }))).toBe(EXPECTED[status])
    })
  }

  it('has no icon when the row carries no status', () => {
    expect(v2StatusIconOf(undefined)).toBeUndefined()
    expect(v2StatusIconOf(view({ status: undefined }))).toBeUndefined()
  })
})

describe('v2StatusIconOf with a pod state', () => {
  for (const sandboxStatus of [
    ESandboxStatus.Sleeping,
    ESandboxStatus.Stopping,
    ESandboxStatus.Stopped,
    ESandboxStatus.Deleting,
    ESandboxStatus.Deleted,
  ]) {
    it(`shows a sleeping pod for ${sandboxStatus} on an idle row`, () => {
      expect(v2StatusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus }))).toBe(
        EThreadStatus.Parked,
      )
    })
  }

  for (const sandboxStatus of [
    ESandboxStatus.Provisioning,
    ESandboxStatus.Starting,
    ESandboxStatus.Restarting,
    ESandboxStatus.Updating,
    ESandboxStatus.Waking,
  ]) {
    it(`shows a spinning ring for ${sandboxStatus} on an idle row`, () => {
      expect(v2StatusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus }))).toBe(
        EThreadStatus.Starting,
      )
    })
  }

  it('keeps the idle circle for a running pod or no pod at all', () => {
    expect(
      v2StatusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus: ESandboxStatus.Running })),
    ).toBe(EThreadStatus.Idle)
    expect(v2StatusIconOf(view({ status: ESessionStatus.Idle }))).toBe(EThreadStatus.Idle)
  })

  it('reports a failed pod on an idle row', () => {
    expect(
      v2StatusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus: ESandboxStatus.Failed })),
    ).toBe(EThreadStatus.Failed)
  })

  it('keeps the session state when the session is not idle', () => {
    const asleep = ESandboxStatus.Sleeping
    expect(v2StatusIconOf(view({ status: ESessionStatus.Thinking, sandboxStatus: asleep }))).toBe(
      EThreadStatus.Running,
    )
    expect(
      v2StatusIconOf(view({ status: ESessionStatus.WaitingForOperator, sandboxStatus: asleep })),
    ).toBe(EThreadStatus.Awaiting)
    expect(v2StatusIconOf(view({ status: ESessionStatus.Failed, sandboxStatus: asleep }))).toBe(
      EThreadStatus.Failed,
    )
    expect(
      v2StatusIconOf(
        view({ status: ESessionStatus.Preparing, sandboxStatus: ESandboxStatus.Sleeping }),
      ),
    ).toBe(EThreadStatus.Starting)
  })

  it('has no icon for a pod state on a row with no session status', () => {
    expect(
      v2StatusIconOf(view({ status: undefined, sandboxStatus: ESandboxStatus.Sleeping })),
    ).toBe(undefined)
  })
})

const view = (overrides: Partial<V2RowView> = {}): V2RowView => ({
  status: undefined,
  sandboxStatus: undefined,
  branch: undefined,
  pullRequest: undefined,
  routineId: undefined,
  sandboxProvider: undefined,
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
