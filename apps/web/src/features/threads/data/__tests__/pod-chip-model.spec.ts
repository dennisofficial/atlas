import { describe, expect, it } from 'bun:test'

import { EPodState as EUiPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import { EBootStep, EBootStepState, EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { chipStatusOf, podStateLabelOf } from '../pod-chip-model'

const step = (at: string) => ({ step: EBootStep.Provision, state: EBootStepState.Running, at })

const pod = (change: Partial<PodStatus>): PodStatus => ({
  state: EPodState.Running,
  resources: { sandboxId: 'sbx_1', region: 'iad1', vcpus: 4 },
  steps: [],
  ...change,
})

describe('chipStatusOf', () => {
  it('has no chip before the pod status loads or for a live pod without a size', () => {
    expect(chipStatusOf(null)).toBeNull()
    expect(chipStatusOf(pod({ state: EPodState.None }))).toBeNull()
    expect(chipStatusOf(pod({ resources: undefined }))).toBeNull()
    expect(chipStatusOf(pod({ resources: { sandboxId: 'sbx_1', region: 'iad1' } }))).toBeNull()
  })

  it('renders a parked pod without resources as parked, not missing', () => {
    const unpersisted = pod({ state: EPodState.Parked, resources: undefined })
    expect(chipStatusOf(unpersisted)).toEqual({ state: EUiPodState.Parked })
    const failed = pod({ state: EPodState.Failed, resources: undefined })
    expect(chipStatusOf(failed)).toEqual({ state: EUiPodState.Stopped })
  })

  it('maps a running pod with its size, id and region', () => {
    expect(chipStatusOf(pod({}))).toEqual({
      state: EUiPodState.Running,
      vcpus: 4,
      podId: 'sbx_1',
      region: 'iad1',
    })
  })

  it('carries the pending size', () => {
    const resources = { sandboxId: 'sbx_1', region: 'iad1', vcpus: 2, pendingVcpus: 8 }
    expect(chipStatusOf(pod({ resources }))?.pendingVcpus).toBe(8)
  })

  it('maps parked and failed', () => {
    expect(chipStatusOf(pod({ state: EPodState.Parked }))?.state).toBe(EUiPodState.Parked)
    expect(chipStatusOf(pod({ state: EPodState.Failed }))?.state).toBe(EUiPodState.Stopped)
  })

  it('reads the first boot as starting and a later attempt as resuming', () => {
    const first = pod({ state: EPodState.Booting, steps: [step('1')], history: [step('1')] })
    expect(chipStatusOf(first)?.state).toBe(EUiPodState.Starting)
    const again = pod({
      state: EPodState.Booting,
      steps: [step('2')],
      history: [step('1'), step('2')],
    })
    expect(chipStatusOf(again)?.state).toBe(EUiPodState.Resuming)
  })
})

describe('podStateLabelOf', () => {
  it('has no label without a pod or for a pod that was never started', () => {
    expect(podStateLabelOf(null)).toBeNull()
    expect(podStateLabelOf(pod({ state: EPodState.None }))).toBeNull()
  })

  it('names the state of a pod whose chip is missing for lack of resources', () => {
    const running = pod({ resources: undefined })
    expect(chipStatusOf(running)).toBeNull()
    expect(podStateLabelOf(running)).toBe('Running')
    expect(podStateLabelOf(pod({ state: EPodState.Booting, resources: undefined }))).toBe(
      'Starting',
    )
  })

  it('names parked and failed pods', () => {
    expect(podStateLabelOf(pod({ state: EPodState.Parked }))).toBe('Parked')
    expect(podStateLabelOf(pod({ state: EPodState.Failed }))).toBe('Failed')
  })
})
