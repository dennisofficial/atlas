import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus } from '@dltech/atlas-protocol'

import { ESessionDisplay, isSessionUnreadOf, sessionDisplayOf } from '../session-display'

const EXPECTED: Record<ESessionStatus, ESessionDisplay> = {
  [ESessionStatus.Failed]: ESessionDisplay.Failed,
  [ESessionStatus.SetupFailed]: ESessionDisplay.StartFailed,
  [ESessionStatus.StartFailed]: ESessionDisplay.StartFailed,
  [ESessionStatus.WaitingForCredentials]: ESessionDisplay.WaitingForYou,
  [ESessionStatus.WaitingForOperator]: ESessionDisplay.WaitingForYou,
  [ESessionStatus.Preparing]: ESessionDisplay.Starting,
  [ESessionStatus.Queued]: ESessionDisplay.Working,
  [ESessionStatus.Thinking]: ESessionDisplay.Working,
  [ESessionStatus.RunningTool]: ESessionDisplay.Working,
  [ESessionStatus.WaitingToRetry]: ESessionDisplay.Working,
  [ESessionStatus.Resuming]: ESessionDisplay.Working,
  [ESessionStatus.WaitingForBackground]: ESessionDisplay.Working,
  [ESessionStatus.Idle]: ESessionDisplay.Idle,
}

const displayOf = (args: { state?: ESessionStatus; sandboxStatus?: ESandboxStatus }) =>
  sessionDisplayOf({ state: args.state, sandboxStatus: args.sandboxStatus })

describe('sessionDisplayOf', () => {
  for (const state of Object.values(ESessionStatus)) {
    it(`maps ${state}`, () => {
      expect(displayOf({ state })).toBe(EXPECTED[state])
    })
  }

  it('has no display when the row carries no status', () => {
    expect(displayOf({})).toBeUndefined()
  })

  it('has no display for a pod state on a row with no session status', () => {
    expect(displayOf({ sandboxStatus: ESandboxStatus.Sleeping })).toBeUndefined()
  })
})

describe('sessionDisplayOf with a pod state', () => {
  for (const sandboxStatus of [
    ESandboxStatus.Sleeping,
    ESandboxStatus.Stopping,
    ESandboxStatus.Stopped,
    ESandboxStatus.Deleting,
    ESandboxStatus.Deleted,
  ]) {
    it(`parks an idle session whose pod is ${sandboxStatus}`, () => {
      expect(displayOf({ state: ESessionStatus.Idle, sandboxStatus })).toBe(ESessionDisplay.Parked)
    })
  }

  for (const sandboxStatus of [
    ESandboxStatus.Provisioning,
    ESandboxStatus.Starting,
    ESandboxStatus.Restarting,
    ESandboxStatus.Updating,
    ESandboxStatus.Waking,
  ]) {
    it(`starts an idle session whose pod is ${sandboxStatus}`, () => {
      expect(displayOf({ state: ESessionStatus.Idle, sandboxStatus })).toBe(
        ESessionDisplay.Starting,
      )
    })
  }

  it('keeps an idle session idle beside a running pod', () => {
    expect(displayOf({ state: ESessionStatus.Idle, sandboxStatus: ESandboxStatus.Running })).toBe(
      ESessionDisplay.Idle,
    )
  })

  it('fails an idle session whose pod failed', () => {
    expect(displayOf({ state: ESessionStatus.Idle, sandboxStatus: ESandboxStatus.Failed })).toBe(
      ESessionDisplay.Failed,
    )
  })

  it('parks background work whose pod went to sleep', () => {
    expect(
      displayOf({
        state: ESessionStatus.WaitingForBackground,
        sandboxStatus: ESandboxStatus.Sleeping,
      }),
    ).toBe(ESessionDisplay.Parked)
  })

  it('keeps background work working beside a running pod', () => {
    expect(
      displayOf({
        state: ESessionStatus.WaitingForBackground,
        sandboxStatus: ESandboxStatus.Running,
      }),
    ).toBe(ESessionDisplay.Working)
  })

  it('keeps the session display when the session is not idle', () => {
    const asleep = ESandboxStatus.Sleeping
    expect(displayOf({ state: ESessionStatus.Thinking, sandboxStatus: asleep })).toBe(
      ESessionDisplay.Working,
    )
    expect(displayOf({ state: ESessionStatus.WaitingForOperator, sandboxStatus: asleep })).toBe(
      ESessionDisplay.WaitingForYou,
    )
    expect(displayOf({ state: ESessionStatus.Failed, sandboxStatus: asleep })).toBe(
      ESessionDisplay.Failed,
    )
    expect(displayOf({ state: ESessionStatus.Preparing, sandboxStatus: asleep })).toBe(
      ESessionDisplay.Starting,
    )
    expect(displayOf({ state: ESessionStatus.StartFailed, sandboxStatus: asleep })).toBe(
      ESessionDisplay.StartFailed,
    )
  })
})

describe('isSessionUnreadOf', () => {
  const unreadOf = (args: {
    display?: ESessionDisplay | undefined
    lastAssistantSeq?: number | undefined
    readSeq?: number | null | undefined
  }) =>
    isSessionUnreadOf({
      display: args.display,
      lastAssistantSeq: args.lastAssistantSeq ?? 5,
      readSeq: args.readSeq ?? null,
    })

  it('marks a session unread when the assistant spoke past the cursor', () => {
    expect(unreadOf({ display: ESessionDisplay.Idle })).toBe(true)
    expect(unreadOf({ display: ESessionDisplay.Idle, readSeq: 4 })).toBe(true)
    expect(unreadOf({ display: ESessionDisplay.Idle, readSeq: 5 })).toBe(false)
    expect(unreadOf({ display: undefined })).toBe(true)
  })

  it('never marks a session with no assistant output', () => {
    expect(unreadOf({ display: ESessionDisplay.Idle, lastAssistantSeq: 0 })).toBe(false)
  })

  it('suppresses the dot while the session works, but not while it waits', () => {
    expect(unreadOf({ display: ESessionDisplay.Working })).toBe(false)
    expect(unreadOf({ display: ESessionDisplay.WaitingForYou })).toBe(true)
    expect(unreadOf({ display: ESessionDisplay.StartFailed })).toBe(true)
    expect(unreadOf({ display: ESessionDisplay.Parked })).toBe(true)
  })
})
