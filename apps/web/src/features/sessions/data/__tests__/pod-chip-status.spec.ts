import { describe, expect, it } from 'bun:test'

import { EPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ESandboxStatus } from '@dltech/atlas-protocol'

import { podChipStatusOf } from '../pod-chip-status'

describe('podChipStatusOf', () => {
  it('renders nothing when the server pushes no pod state', () => {
    expect(podChipStatusOf({ pod: undefined, live: true })).toBeNull()
  })

  it('shows the applied size of a steady pod', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
        live: true,
      }),
    ).toEqual({ state: EPodState.Running, vcpus: 4, phase: 'steady' })
  })

  it('keeps the applied size and names the target while resizing', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 8, actualVcpus: 4, phase: 'resizing' },
        live: true,
      }),
    ).toEqual({ state: EPodState.Running, vcpus: 4, pendingVcpus: 8, phase: 'resizing' })
  })

  it('keeps the applied size and names the target while the resize waits for idle', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 8, actualVcpus: 4, phase: 'waiting' },
        live: true,
      }),
    ).toEqual({ state: EPodState.Running, vcpus: 4, pendingVcpus: 8, phase: 'waiting' })
  })

  it('carries the error of a failed resize', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 8, actualVcpus: 4, phase: 'failed', error: 'quota' },
        live: true,
      }),
    ).toEqual({
      state: EPodState.Running,
      vcpus: 4,
      pendingVcpus: 8,
      phase: 'failed',
      resizeError: 'quota',
    })
  })

  it('parks a pod the lease does not hold live', () => {
    expect(
      podChipStatusOf({ pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' }, live: false }),
    ).toEqual({ state: EPodState.Parked, vcpus: 4, phase: 'steady' })
  })

  it('shows the state agent37 declares over the lease', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
        live: false,
        sandbox: { status: ESandboxStatus.Running, at: '2026-11-21T09:30:00.000Z' },
      }),
    ).toEqual({ state: EPodState.Running, vcpus: 4, phase: 'steady' })
  })

  it('parks a sleeping pod and says it sleeps', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
        live: true,
        sandbox: {
          status: ESandboxStatus.Sleeping,
          at: '2026-11-21T09:30:00.000Z',
          reason: 'idle timeout',
        },
      }),
    ).toEqual({
      state: EPodState.Parked,
      label: 'Sleeping',
      reason: 'idle timeout',
      vcpus: 4,
      phase: 'steady',
    })
  })

  it('starts a pod agent37 is still bringing up', () => {
    for (const status of [
      ESandboxStatus.Provisioning,
      ESandboxStatus.Starting,
      ESandboxStatus.Restarting,
      ESandboxStatus.Updating,
    ]) {
      expect(
        podChipStatusOf({
          pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
          live: true,
          sandbox: { status, at: '2026-11-21T09:30:00.000Z' },
        })?.state,
      ).toBe(EPodState.Starting)
    }
  })

  it('resumes a pod agent37 is waking from sleep', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
        live: true,
        sandbox: { status: ESandboxStatus.Waking, at: '2026-11-21T09:30:00.000Z' },
      })?.state,
    ).toBe(EPodState.Resuming)
  })

  it('stops a pod agent37 stopped', () => {
    for (const status of [
      ESandboxStatus.Stopping,
      ESandboxStatus.Stopped,
      ESandboxStatus.Deleting,
      ESandboxStatus.Deleted,
    ]) {
      expect(
        podChipStatusOf({
          pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
          live: true,
          sandbox: { status, at: '2026-11-21T09:30:00.000Z' },
        })?.state,
      ).toBe(EPodState.Stopped)
    }
  })

  it('stops a failed pod and carries the reason it declared', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
        live: true,
        sandbox: {
          status: ESandboxStatus.Failed,
          at: '2026-11-21T09:30:00.000Z',
          reason: 'no capacity in us',
        },
      }),
    ).toEqual({
      state: EPodState.Stopped,
      label: 'Failed',
      reason: 'no capacity in us',
      vcpus: 4,
      phase: 'steady',
    })
  })

  it('falls back to the lease when the provider declares no state', () => {
    expect(
      podChipStatusOf({
        pod: { desiredVcpus: 4, actualVcpus: 4, phase: 'steady' },
        live: false,
        sandbox: null,
      }),
    ).toEqual({ state: EPodState.Parked, vcpus: 4, phase: 'steady' })
  })
})
