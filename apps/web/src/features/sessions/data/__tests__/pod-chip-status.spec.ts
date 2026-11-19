import { describe, expect, it } from 'bun:test'

import { EPodState } from '@dltech/atlas-ui/ai/pod-status-chip'

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
})
