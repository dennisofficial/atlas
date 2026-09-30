import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import React, { act } from 'react'

import { useExecutionLocation, type ExecutionLocationControl } from '../use-execution-location'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const THREAD: ThreadId = 'thread-under-test' as ThreadId

type Probe = { current: ExecutionLocationControl | null }

function Harness(args: { probe: Probe; app: FakeApp; stored: EExecutionLocation | undefined }) {
  args.probe.current = useExecutionLocation({
    app: args.app,
    threadId: THREAD,
    stored: args.stored,
  })
  return <box />
}

type Mounted = {
  setup: TestRendererSetup
  root: Root
  probe: Probe
  app: FakeApp
}

const live: Mounted[] = []

async function mount(args: {
  stored: EExecutionLocation | undefined
  app: FakeApp
}): Promise<Mounted> {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const probe: Probe = { current: null }
  await act(async () => {
    root.render(<Harness probe={probe} app={args.app} stored={args.stored} />)
    await setup.flush()
  })
  await act(async () => {
    await Promise.resolve()
  })
  const mounted = { setup, root, probe, app: args.app }
  live.push(mounted)
  return mounted
}

afterEach(() => {
  const mounted = live.pop()
  if (mounted === undefined) return
  mounted.root.unmount()
  mounted.setup.renderer.destroy()
})

const appWith = async (location: EExecutionLocation): Promise<FakeApp> => {
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
  await app.threads.create({ id: THREAD, executionLocation: location })
  return app
}

describe('the location the footer reads', () => {
  it('shows where the session is durably placed rather than what a mount would default to', async () => {
    const app = await appWith(EExecutionLocation.Cloud)

    const { probe } = await mount({ stored: undefined, app })

    expect(probe.current?.location).toBe(EExecutionLocation.Cloud)
  })

  it('writes no placement of its own, so remounting a cloud thread cannot send it home', async () => {
    const app = await appWith(EExecutionLocation.Cloud)

    const first = await mount({ stored: EExecutionLocation.Cloud, app })
    first.root.unmount()
    first.setup.renderer.destroy()
    live.pop()

    const { probe } = await mount({ stored: undefined, app })

    expect(probe.current?.location).toBe(EExecutionLocation.Cloud)
    expect(app.threads.chosenLocations).toEqual([])
  })
})
