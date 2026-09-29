import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import React, { act } from 'react'

import { useExecutionLocation, type ExecutionLocationControl } from '../use-execution-location'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const THREAD: ThreadId = 'thread-under-test' as ThreadId
const AT = '2026-08-25T00:00:00.000Z'

type Probe = { current: ExecutionLocationControl | null }

function Harness(args: {
  probe: Probe
  app: FakeApp
  stored: EExecutionLocation | undefined
  started: boolean
}) {
  args.probe.current = useExecutionLocation({
    app: args.app,
    threadId: THREAD,
    stored: args.stored,
    started: args.started,
  })
  return <box />
}

type Mounted = {
  setup: TestRendererSetup
  root: Root
  probe: Probe
  app: FakeApp
  render: (args: { stored: EExecutionLocation | undefined; started: boolean }) => Promise<void>
}

const live: Mounted[] = []

async function mount(args: {
  stored: EExecutionLocation | undefined
  started: boolean
  app?: FakeApp
}): Promise<Mounted> {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const app = args.app ?? fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })
  const probe: Probe = { current: null }
  const render = async (next: { stored: EExecutionLocation | undefined; started: boolean }) => {
    await act(async () => {
      root.render(
        <Harness probe={probe} app={app} stored={next.stored} started={next.started} />,
      )
      await setup.flush()
    })
  }
  await render(args)
  const mounted = { setup, root, probe, app, render }
  live.push(mounted)
  return mounted
}

afterEach(() => {
  const mounted = live.pop()
  if (mounted === undefined) return
  mounted.root.unmount()
  mounted.setup.renderer.destroy()
})

describe('useExecutionLocation', () => {
  it('persists a user-driven switch on a started thread', async () => {
    const { probe, app } = await mount({ stored: EExecutionLocation.Host, started: true })
    await app.threads.create({ id: THREAD })

    probe.current?.handleSet(EExecutionLocation.Docker)
    await act(async () => {
      await Promise.resolve()
    })

    expect(app.executionLocation.current()).toBe(EExecutionLocation.Docker)
    expect(app.threads.chosenLocations).toEqual([
      { threadId: THREAD, location: EExecutionLocation.Docker },
    ])
  })

  it('does not write the meta when a never-started thread switches locally', async () => {
    const { probe, app } = await mount({ stored: undefined, started: false })

    probe.current?.handleSet(EExecutionLocation.Docker)
    await act(async () => {
      await Promise.resolve()
    })

    expect(app.executionLocation.current()).toBe(EExecutionLocation.Docker)
    expect(app.threads.chosenLocations).toEqual([])
  })

  it('treats a remount of a started cloud thread as a no-op against the meta', async () => {
    const first = await mount({ stored: EExecutionLocation.Cloud, started: true })
    first.root.unmount()
    first.setup.renderer.destroy()
    live.pop()

    const { app } = await mount({ stored: EExecutionLocation.Cloud, started: true })
    await act(async () => {
      await Promise.resolve()
    })

    expect(app.executionLocation.current()).toBe(EExecutionLocation.Cloud)
    expect(app.threads.chosenLocations).toEqual([])
  })

  it('does not regress a cloud thread when a remount watches started flip false to true', async () => {
    const { render, app } = await mount({ stored: EExecutionLocation.Cloud, started: false })
    app.threads.seedThread({
      id: THREAD,
      head: 0,
      createdAt: AT,
      updatedAt: AT,
      workspace: null,
      repo: null,
      executionLocation: EExecutionLocation.Cloud,
    })

    await render({ stored: EExecutionLocation.Cloud, started: true })
    await act(async () => {
      await Promise.resolve()
    })

    expect(app.threads.chosenLocations).toEqual([])
    expect(app.threads.peekRow({ threadId: THREAD })?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
  })
})
