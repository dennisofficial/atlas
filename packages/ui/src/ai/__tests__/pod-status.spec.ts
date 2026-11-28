import { describe, expect, it } from 'bun:test'

import { chipLabel, EPodState } from '../pod-status'

describe('chipLabel', () => {
  it('names the state when the provider declared one', () => {
    expect(chipLabel({ state: EPodState.Parked, label: 'Sleeping', vcpus: 4 })).toBe('Sleeping')
    expect(chipLabel({ state: EPodState.Stopped, label: 'Failed' })).toBe('Failed')
  })

  it('sizes a running pod by default', () => {
    expect(chipLabel({ state: EPodState.Running, vcpus: 4 })).toBe('4 vCPU, 8 GB')
  })

  it('prefers a failed resize over the declared label', () => {
    expect(
      chipLabel({ state: EPodState.Running, label: 'Running', phase: 'failed', vcpus: 4 }),
    ).toBe('Resize failed')
  })
})
