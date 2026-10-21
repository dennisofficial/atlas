import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'vitest'
import React, { act } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import { useContainerMove, type ContainerMoveControl } from '../use-container-move'

const ROWS = [{ id: 'provision', text: 'waiting for the pod', nodeIds: ['provision'] }]

type Probe = { control: ContainerMoveControl | null }

function ControlProbe(props: { probe: Probe }): React.ReactNode {
  props.probe.control = useContainerMove()
  return null
}

type PressedKey = { name: string; ctrl?: boolean; eventType: string }

const key = (over: { name: string; ctrl?: boolean }): PressedKey => ({ eventType: 'press', ...over })

const arrange = async () => {
  const probe: Probe = { control: null }
  const setup = await testRender(<ControlProbe probe={probe} />, { width: 20, height: 4 })
  const flush = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await setup.renderOnce()
    })
  }
  const control = (): ContainerMoveControl => {
    if (probe.control === null) throw new Error('probe never mounted')
    return probe.control
  }
  return { control, flush }
}

const begin = async (args: { onCancel?: () => void }) => {
  const mounted = await arrange()
  mounted.control().handleBegin({ target: EExecutionLocation.Cloud, rows: ROWS, ...args })
  await mounted.flush()
  return mounted
}

describe('cancelling a cloud birth', () => {
  for (const cancel of [key({ name: 'escape' }), key({ name: 'c', ctrl: true })]) {
    it(`takes the overlay down and runs the fallback on ${cancel.ctrl === true ? 'ctrl+c' : 'esc'}`, async () => {
      let cancelled = 0
      const mounted = await begin({ onCancel: () => (cancelled += 1) })
      expect(mounted.control().move?.cancellable).toBe(true)

      mounted.control().handleKey(cancel as never)
      await mounted.flush()

      expect(cancelled).toBe(1)
      expect(mounted.control().move).toBeNull()
    })
  }

  it('does not run the fallback twice when cancel is pressed again', async () => {
    let cancelled = 0
    const mounted = await begin({ onCancel: () => (cancelled += 1) })

    mounted.control().handleKey(key({ name: 'escape' }) as never)
    mounted.control().handleKey(key({ name: 'escape' }) as never)
    await mounted.flush()

    expect(cancelled).toBe(1)
  })

  it('leaves a move without a fallback running when esc is pressed', async () => {
    const mounted = await begin({})

    mounted.control().handleKey(key({ name: 'escape' }) as never)
    await mounted.flush()

    expect(mounted.control().move).not.toBeNull()
  })

  it('does not cancel once the birth has failed — esc only dismisses the failure', async () => {
    let cancelled = 0
    const mounted = await begin({ onCancel: () => (cancelled += 1) })
    mounted.control().handleFail('the sandbox would not start')
    await mounted.flush()

    mounted.control().handleKey(key({ name: 'escape' }) as never)
    await mounted.flush()

    expect(cancelled).toBe(0)
    expect(mounted.control().move).toBeNull()
  })

  it('counts elapsed time up from when the birth began', async () => {
    const mounted = await begin({ onCancel: () => undefined })
    const first = mounted.control().now
    await new Promise((resolve) => setTimeout(resolve, 600))
    await mounted.flush()

    expect(mounted.control().now).toBeGreaterThan(first)
    expect(mounted.control().now - (mounted.control().move?.startedAt ?? 0)).toBeGreaterThanOrEqual(0)
  })

  it('records a context upload reading through the control surface', async () => {
    const mounted = await begin({ onCancel: () => undefined })
    mounted.control().handleNodeStart('provision')
    mounted.control().handleTransferProgress({
      nodeId: 'provision',
      transferId: 'context-upload',
      label: 'uploading local config',
      transferredBytes: 3,
      totalBytes: 9,
      complete: false,
    })
    await mounted.flush()

    expect(mounted.control().move?.rows[0]?.transfers?.[0]?.transferredBytes).toBe(3)
  })
})
