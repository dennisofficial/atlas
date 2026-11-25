import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus } from '@dltech/atlas-protocol'

import { EThreadStatus } from '../thread-status'
import { type RowView, isSessionUnread, statusIconOf } from '../row-status'

const EXPECTED: Record<ESessionStatus, EThreadStatus> = {
  [ESessionStatus.Failed]: EThreadStatus.Failed,
  [ESessionStatus.SetupFailed]: EThreadStatus.Failed,
  [ESessionStatus.StartFailed]: EThreadStatus.Failed,
  [ESessionStatus.WaitingForCredentials]: EThreadStatus.Awaiting,
  [ESessionStatus.WaitingForOperator]: EThreadStatus.Awaiting,
  [ESessionStatus.Preparing]: EThreadStatus.Starting,
  [ESessionStatus.Queued]: EThreadStatus.Running,
  [ESessionStatus.Thinking]: EThreadStatus.Running,
  [ESessionStatus.RunningTool]: EThreadStatus.Running,
  [ESessionStatus.WaitingForBackground]: EThreadStatus.Running,
  [ESessionStatus.WaitingToRetry]: EThreadStatus.Running,
  [ESessionStatus.Resuming]: EThreadStatus.Running,
  [ESessionStatus.RunningCommand]: EThreadStatus.Running,
  [ESessionStatus.Idle]: EThreadStatus.Idle,
}

describe('statusIconOf', () => {
  for (const status of Object.values(ESessionStatus)) {
    it(`maps ${status}`, () => {
      expect(statusIconOf(view({ status }))).toBe(EXPECTED[status])
    })
  }

  it('has no icon when the row carries no status', () => {
    expect(statusIconOf(undefined)).toBeUndefined()
    expect(statusIconOf(view({ status: undefined }))).toBeUndefined()
  })
})

describe('statusIconOf with a pod state', () => {
  for (const sandboxStatus of [
    ESandboxStatus.Sleeping,
    ESandboxStatus.Stopping,
    ESandboxStatus.Stopped,
    ESandboxStatus.Deleting,
    ESandboxStatus.Deleted,
  ]) {
    it(`shows a sleeping pod for ${sandboxStatus} on an idle row`, () => {
      expect(statusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus }))).toBe(
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
      expect(statusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus }))).toBe(
        EThreadStatus.Starting,
      )
    })
  }

  it('keeps the idle circle for a running pod or no pod at all', () => {
    expect(
      statusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus: ESandboxStatus.Running })),
    ).toBe(EThreadStatus.Idle)
    expect(statusIconOf(view({ status: ESessionStatus.Idle }))).toBe(EThreadStatus.Idle)
  })

  it('reports a failed pod on an idle row', () => {
    expect(
      statusIconOf(view({ status: ESessionStatus.Idle, sandboxStatus: ESandboxStatus.Failed })),
    ).toBe(EThreadStatus.Failed)
  })

  it('keeps the session state when the session is not idle', () => {
    const asleep = ESandboxStatus.Sleeping
    expect(statusIconOf(view({ status: ESessionStatus.Thinking, sandboxStatus: asleep }))).toBe(
      EThreadStatus.Running,
    )
    expect(
      statusIconOf(view({ status: ESessionStatus.WaitingForOperator, sandboxStatus: asleep })),
    ).toBe(EThreadStatus.Awaiting)
    expect(statusIconOf(view({ status: ESessionStatus.Failed, sandboxStatus: asleep }))).toBe(
      EThreadStatus.Failed,
    )
    expect(
      statusIconOf(
        view({ status: ESessionStatus.Preparing, sandboxStatus: ESandboxStatus.Sleeping }),
      ),
    ).toBe(EThreadStatus.Starting)
  })

  it('has no icon for a pod state on a row with no session status', () => {
    expect(statusIconOf(view({ status: undefined, sandboxStatus: ESandboxStatus.Sleeping }))).toBe(
      undefined,
    )
  })
})

const view = (overrides: Partial<RowView> = {}): RowView => ({
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

describe('isSessionUnread', () => {
  it('marks a row unread when the assistant spoke past the cursor', () => {
    expect(isSessionUnread({ view: view(), active: false })).toBe(true)
    expect(isSessionUnread({ view: view({ readSeq: 4 }), active: false })).toBe(true)
    expect(isSessionUnread({ view: view({ readSeq: 5 }), active: false })).toBe(false)
  })

  it('never marks the active row or a row with no assistant output', () => {
    expect(isSessionUnread({ view: view(), active: true })).toBe(false)
    expect(isSessionUnread({ view: view({ lastAssistantSeq: 0 }), active: false })).toBe(false)
  })

  it('suppresses the dot while the session works, but not while it awaits', () => {
    expect(
      isSessionUnread({ view: view({ status: ESessionStatus.Thinking }), active: false }),
    ).toBe(false)
    expect(
      isSessionUnread({ view: view({ status: ESessionStatus.WaitingForOperator }), active: false }),
    ).toBe(true)
  })
})
