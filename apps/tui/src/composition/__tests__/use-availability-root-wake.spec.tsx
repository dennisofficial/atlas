import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { createRoot, type Root } from '@opentui/react'
import { testRender } from '@opentui/react/test-utils'
import React, { act } from 'react'

import { useAvailabilityRootWake, type RootWakeControl } from '../use-availability-root-wake'

const ROOT = toThreadId('root-thread')
const CHILD = toThreadId('child-thread')

type FakeControl = RootWakeControl & {
  wake: (threadId: ThreadId) => void
  bound: () => boolean
}

const fakeControl = (): FakeControl => {
  let bound: ((args: { threadId: ThreadId }) => void) | undefined
  return {
    bindRootWake: (wake) => {
      bound = wake
      return () => {
        if (bound === wake) bound = undefined
      }
    },
    wake: (threadId) => bound?.({ threadId }),
    bound: () => bound !== undefined,
  }
}

const Probe = (props: {
  control: RootWakeControl | undefined
  onWake: () => void
}): React.ReactNode => {
  useAvailabilityRootWake({ control: props.control, threadId: ROOT, onWake: props.onWake })
  return <text>probe</text>
}

type Mounted = { root: Root; destroy: () => void }
const mounted: Mounted[] = []

const mount = async (element: React.ReactNode): Promise<Root> => {
  const setup = await testRender(<text>idle</text>, { width: 20, height: 3 })
  const root = createRoot(setup.renderer)
  mounted.push({ root, destroy: () => setup.renderer.destroy() })
  await act(async () => {
    root.render(element)
    await setup.flush()
  })
  return root
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount())
    entry.destroy()
  }
})

describe('useAvailabilityRootWake', () => {
  it('runs the next turn once when the root thread is woken', async () => {
    const control = fakeControl()
    let wakes = 0
    await mount(
      <Probe
        control={control}
        onWake={() => {
          wakes += 1
        }}
      />,
    )
    control.wake(ROOT)
    expect(wakes).toBe(1)
  })

  it('ignores a wake for another thread', async () => {
    const control = fakeControl()
    let wakes = 0
    await mount(
      <Probe
        control={control}
        onWake={() => {
          wakes += 1
        }}
      />,
    )
    control.wake(CHILD)
    expect(wakes).toBe(0)
  })

  it('unbinds on unmount', async () => {
    const control = fakeControl()
    let wakes = 0
    const root = await mount(
      <Probe
        control={control}
        onWake={() => {
          wakes += 1
        }}
      />,
    )
    expect(control.bound()).toBe(true)
    act(() => root.unmount())
    expect(control.bound()).toBe(false)
    control.wake(ROOT)
    expect(wakes).toBe(0)
  })

  it('binds nothing when the session has no availability control', async () => {
    let wakes = 0
    await mount(
      <Probe
        control={undefined}
        onWake={() => {
          wakes += 1
        }}
      />,
    )
    expect(wakes).toBe(0)
  })
})
