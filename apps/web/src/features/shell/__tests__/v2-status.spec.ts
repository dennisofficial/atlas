import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import { EThreadStatus } from '../thread-status'
import { v2StatusIconOf } from '../v2-status'

const EXPECTED: Record<ESessionStatus, EThreadStatus> = {
  [ESessionStatus.Failed]: EThreadStatus.Failed,
  [ESessionStatus.SetupFailed]: EThreadStatus.Failed,
  [ESessionStatus.StartFailed]: EThreadStatus.Failed,
  [ESessionStatus.WaitingForCredentials]: EThreadStatus.Awaiting,
  [ESessionStatus.Preparing]: EThreadStatus.Starting,
  [ESessionStatus.Sent]: EThreadStatus.Running,
  [ESessionStatus.Thinking]: EThreadStatus.Running,
  [ESessionStatus.RunningTool]: EThreadStatus.Running,
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
