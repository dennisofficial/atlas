import { describe, expect, it } from 'bun:test'

import { ESandboxStatus, type SessionStatusOutput } from '@dltech/atlas-protocol'

import { isPodParked, podAttached, podReady } from '../pod-attachment'

const statusOf = (status: ESandboxStatus): SessionStatusOutput => ({
  state: 'idle' as SessionStatusOutput['state'],
  lease: { epoch: 1, holderHostId: null, live: false },
  sandbox: { status, at: '2026-01-01T00:00:00.000Z' },
})

describe('pod attachment', () => {
  it('treats a missing holder on a running sandbox as attached', () => {
    expect(podAttached(statusOf(ESandboxStatus.Running))).toBe(true)
    expect(isPodParked(statusOf(ESandboxStatus.Running))).toBe(false)
  })

  it('treats a parked sandbox as parked', () => {
    expect(isPodParked(statusOf(ESandboxStatus.Sleeping))).toBe(true)
    expect(podAttached(statusOf(ESandboxStatus.Stopped))).toBe(false)
  })

  it('waits for a live holder before it calls the pod ready', () => {
    expect(podReady(undefined)).toBe(false)
    expect(podReady(statusOf(ESandboxStatus.Running))).toBe(false)
    expect(
      podReady({
        ...statusOf(ESandboxStatus.Running),
        lease: { epoch: 1, holderHostId: 7, live: true },
      }),
    ).toBe(true)
    expect(
      podReady({
        ...statusOf(ESandboxStatus.Running),
        lease: { epoch: 1, holderHostId: 7, live: false },
      }),
    ).toBe(false)
    expect(
      podReady({
        ...statusOf(ESandboxStatus.Sleeping),
        lease: { epoch: 1, holderHostId: 7, live: true },
      }),
    ).toBe(false)
  })

  it('treats an unrecorded sandbox as attached so a request can wake it', () => {
    expect(podAttached(undefined)).toBe(true)
    expect(
      podAttached({
        state: 'idle' as SessionStatusOutput['state'],
        lease: { epoch: 0, holderHostId: null, live: false },
        sandbox: null,
      }),
    ).toBe(true)
  })
})
