import { describe, expect, it } from 'bun:test'

import {
  canResize,
  chipLabel,
  EPodState,
  ramOf,
  sizeLabel,
  VCPU_STEPS,
  type PodStatus,
} from '../pod-status'

const RUNNING: PodStatus = {
  state: EPodState.Running,
  vcpus: 4,
  podId: 'pod_1',
  region: 'iad1',
}

describe('pod size', () => {
  it('links RAM at 2 GB per vCPU across the 2/4/8 steps', () => {
    expect(VCPU_STEPS).toEqual([2, 4, 8])
    expect(VCPU_STEPS.map(ramOf)).toEqual([4, 8, 16])
    expect(sizeLabel(4)).toBe('4 vCPU · 8 GB')
  })
})

describe('chipLabel', () => {
  it('shows only the size while running', () => {
    expect(chipLabel(RUNNING)).toBe('4 vCPU · 8 GB')
  })

  it('names the state beside the size while resuming', () => {
    expect(chipLabel({ ...RUNNING, state: EPodState.Resuming })).toBe('Resuming · 4 vCPU · 8 GB')
  })

  it('shows only the state when parked or starting', () => {
    expect(chipLabel({ ...RUNNING, state: EPodState.Parked })).toBe('Parked')
    expect(chipLabel({ ...RUNNING, state: EPodState.Starting })).toBe('Starting')
  })
})

describe('canResize', () => {
  it('allows resize for running, resuming and parked pods only', () => {
    expect(canResize(EPodState.Running)).toBe(true)
    expect(canResize(EPodState.Resuming)).toBe(true)
    expect(canResize(EPodState.Parked)).toBe(true)
    expect(canResize(EPodState.Starting)).toBe(false)
    expect(canResize(EPodState.Stopped)).toBe(false)
  })
})
