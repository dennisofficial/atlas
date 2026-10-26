import { describe, expect, it } from 'bun:test'

import { EPodState as EUiPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import { EBootStep, EBootStepState, EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { chipStatusOf } from '../pod-chip-model'

const step = (at: string) => ({ step: EBootStep.Provision, state: EBootStepState.Running, at })

const pod = (change: Partial<PodStatus>): PodStatus => ({
  state: EPodState.Running,
  resources: { sandboxId: 'sbx_1', region: 'iad1', vcpus: 4 },
  steps: [],
  ...change,
})

describe('chipStatusOf', () => {
  it('has no chip before the pod status loads or without a sized pod', () => {
    expect(chipStatusOf(null)).toBeNull()
    expect(chipStatusOf(pod({ state: EPodState.None }))).toBeNull()
    expect(chipStatusOf(pod({ resources: undefined }))).toBeNull()
    expect(chipStatusOf(pod({ resources: { sandboxId: 'sbx_1', region: 'iad1' } }))).toBeNull()
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
