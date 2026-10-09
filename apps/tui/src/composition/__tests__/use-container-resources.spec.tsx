import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import {
  DEFAULT_SANDBOX_VCPUS,
  EResourcesPhase,
  memoryGbOf,
  SANDBOX_VCPU_STEPS,
  useContainerResources,
  type ContainerResourcesControl,
} from '../use-container-resources'

const key = (name: string) => ({ name }) as never

type Probe = { control: ContainerResourcesControl | null }

function ControlProbe(props: {
  readResources: () => Promise<{ vcpus?: number; memoryMb?: number }>
  updateResources: (vcpus: number) => Promise<void>
  probe: Probe
}): React.ReactNode {
  props.probe.control = useContainerResources({
    readResources: props.readResources,
    updateResources: props.updateResources,
  })
  return null
}

const arrange = async (args: {
  live?: number | undefined
  readFails?: boolean
  applied?: number[]
  updateFails?: boolean
}): Promise<{ probe: Probe; flush: () => Promise<void> }> => {
  const probe: Probe = { control: null }
  const setup = await testRender(
    <ControlProbe
      probe={probe}
      readResources={async () => {
        if (args.readFails === true) throw new Error('vercel is down')
        return args.live === undefined ? {} : { vcpus: args.live, memoryMb: args.live * 2048 }
      }}
      updateResources={async (vcpus) => {
        if (args.updateFails === true) throw new Error('plan ceiling')
        args.applied?.push(vcpus)
      }}
    />,
    { width: 60, height: 10 },
  )
  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await setup.renderOnce()
  }
  await flush()
  return { probe, flush }
}

describe('useContainerResources', () => {
  it('opens at the allocation the provider reports, clamped onto the steps', async () => {
    const { probe, flush } = await arrange({ live: 4 })
    probe.control?.handleOpen()
    await flush()

    expect(probe.control?.state).toEqual({ phase: EResourcesPhase.Ready, vcpus: 4, error: null })
  })

  it('opens at the default when the provider does not say', async () => {
    const { probe, flush } = await arrange({ live: undefined })
    probe.control?.handleOpen()
    await flush()
    await flush()

    expect(probe.control?.state?.vcpus).toBe(DEFAULT_SANDBOX_VCPUS)
  })

  it('surfaces a failed read as an in-overlay error and stays usable', async () => {
    const { probe, flush } = await arrange({ readFails: true })
    probe.control?.handleOpen()
    await flush()
    await flush()

    expect(probe.control?.state?.phase).toBe(EResourcesPhase.Ready)
    expect(probe.control?.state?.error).toContain('vercel is down')
  })

  it('steps with the arrows, bounded by the plan ceiling and floor', async () => {
    const { probe, flush } = await arrange({ live: 2 })
    probe.control?.handleOpen()
    await flush()
    await flush()

    probe.control?.handleKey(key('left'))
    await flush()
    expect(probe.control?.state?.vcpus).toBe(2)
    probe.control?.handleKey(key('right'))
    await flush()
    probe.control?.handleKey(key('right'))
    await flush()
    probe.control?.handleKey(key('right'))
    await flush()
    expect(probe.control?.state?.vcpus).toBe(SANDBOX_VCPU_STEPS[SANDBOX_VCPU_STEPS.length - 1])
    probe.control?.handleKey(key('down'))
    await flush()
    expect(probe.control?.state?.vcpus).toBe(4)
    probe.control?.handleKey(key('left'))
    await flush()
    expect(probe.control?.state?.vcpus).toBe(2)
    probe.control?.handleKey(key('up'))
    await flush()
    expect(probe.control?.state?.vcpus).toBe(4)
  })

  it('applies through the bridge on Enter and closes', async () => {
    const applied: number[] = []
    const { probe, flush } = await arrange({ live: 2, applied })
    probe.control?.handleOpen()
    await flush()
    await flush()
    probe.control?.handleKey(key('right'))
    await flush()
    probe.control?.handleKey(key('return'))
    await flush()

    expect(applied).toEqual([4])
    expect(probe.control?.state).toBe(null)
  })

  it('keeps the overlay open with the provider error when the apply fails', async () => {
    const { probe, flush } = await arrange({ live: 2, updateFails: true })
    probe.control?.handleOpen()
    await flush()
    await flush()
    probe.control?.handleKey(key('return'))
    await flush()
    await flush()

    expect(probe.control?.state?.phase).toBe(EResourcesPhase.Ready)
    expect(probe.control?.state?.error).toContain('plan ceiling')
  })

  it('cancels on Escape without applying anything', async () => {
    const applied: number[] = []
    const { probe, flush } = await arrange({ live: 4, applied })
    probe.control?.handleOpen()
    await flush()
    await flush()
    probe.control?.handleKey(key('escape'))
    await flush()

    expect(probe.control?.state).toBe(null)
    expect(applied).toEqual([])
  })

  it('derives RAM at 2 GB per vCPU', () => {
    expect(memoryGbOf(2)).toBe(4)
    expect(memoryGbOf(8)).toBe(16)
  })
})
