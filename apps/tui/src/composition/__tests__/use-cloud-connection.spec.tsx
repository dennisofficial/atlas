import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  EConnectionView,
  ECloudSandboxState,
  EResizeApplies,
  type ChannelConnection,
  type CloudConnection,
} from '@dltech/atlas-harness'
import React, { act } from 'react'

import type { CloudSession } from '../cloud/cloud-session'
import { createCloudSession } from '../cloud/cloud-session'
import { fakeCloudChannel } from '../cloud/__tests__/fixture'
import { ERuntimeKind } from '@dltech/atlas-harness'
import { useCloudConnection, useCloudHealth } from '../use-cloud-connection'
import { currentNotices } from '../../ui/notice-store'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const THREAD: ThreadId = 'thread-under-test' as ThreadId

const HOST_THREAD: ThreadId = 'host-thread-under-test' as ThreadId

const switchToHostThread = async (app: FakeApp): Promise<void> => {
  await app.threads.create({ id: HOST_THREAD, executionLocation: EExecutionLocation.Host })
  await app.sessionOwner.activateLocal({ threadId: HOST_THREAD, fallback: EExecutionLocation.Host })
}

const sessionOn = (connection?: ChannelConnection): CloudSession =>
  sessionOver(fakeCloudChannel({ connection }))

const sessionOver = (channel: ReturnType<typeof fakeCloudChannel>): CloudSession => {
  return createCloudSession({
    channel,
    sandboxes: {
      create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
      find: async () => undefined,
      readResources: async () => ({}),
      updateResources: async () => ({ appliesAt: EResizeApplies.Live }),
      destroy: async () => undefined,
    },
    wake: async () => undefined,
    onReload: async () => undefined,
  })
}

type Probe = { current: CloudConnection | null | undefined }
type HealthProbe = { current: ReturnType<typeof useCloudHealth> | undefined }

function HealthHarness(args: { probe: HealthProbe; app: FakeApp; session: CloudSession | null }) {
  args.probe.current = useCloudHealth({ app: args.app, session: args.session })
  return <box />
}

function Harness(args: { probe: Probe; app: FakeApp; session: CloudSession | null }) {
  args.probe.current = useCloudConnection({ app: args.app, session: args.session })
  return <box />
}

type Mounted = {
  setup: TestRendererSetup
  root: Root
  probe: Probe
}

const live: Mounted[] = []

async function mount(args: {
  app: FakeApp
  location: EExecutionLocation
  session: CloudSession | null
  attached?: boolean
}): Promise<Mounted> {
  await args.app.threads.create({ id: THREAD, executionLocation: args.location })
  const local = args.app.sessionOwner.require()
  await args.app.executionLocation.activate({ threadId: THREAD, fallback: args.location })
  if (args.location === EExecutionLocation.Cloud && args.attached !== false) {
    await args.app.sessionOwner.adopt({
      threadId: THREAD,
      binding: { kind: ERuntimeKind.Cloud, cwd: '/sandbox', adapters: local.adapters },
    })
  }
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const probe: Probe = { current: undefined }
  await act(async () => {
    root.render(<Harness probe={probe} app={args.app} session={args.session} />)
    await setup.flush()
  })
  await act(async () => {
    await Promise.resolve()
  })
  const mounted = { setup, root, probe }
  live.push(mounted)
  return mounted
}

afterEach(() => {
  for (const mounted of [live.pop(), liveHealth.pop()]) {
    if (mounted === undefined) continue
    mounted.root.unmount()
    mounted.setup.renderer.destroy()
  }
})

const appFor = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })

describe('the connection the cloud chrome reads', () => {
  it('is the session health while the placement says cloud', async () => {
    const session = sessionOn({ state: EConnectionView.Connected, detail: null })
    const { probe } = await mount({ app: appFor(), location: EExecutionLocation.Cloud, session })

    expect(probe.current?.state).toBe(EConnectionView.Connected)
  })

  it('is absent once the active thread is placed at home, even over a stale open socket', async () => {
    const app = appFor()
    const session = sessionOn({ state: EConnectionView.Connected, detail: null })
    const { probe, root } = await mount({ app, location: EExecutionLocation.Cloud, session })

    expect(probe.current?.state).toBe(EConnectionView.Connected)

    await act(async () => {
      root.render(<Harness probe={probe} app={app} session={null} />)
    })

    expect(probe.current).toBeNull()
  })

  it('drops a lingering open socket once the active thread is placed at home', async () => {
    const app = appFor()
    const session = sessionOn({ state: EConnectionView.Connected, detail: null })
    const { probe } = await mount({ app, location: EExecutionLocation.Cloud, session })

    expect(probe.current?.state).toBe(EConnectionView.Connected)

    await act(async () => {
      await switchToHostThread(app)
    })

    expect(probe.current).toBeNull()
  })

  it('keeps the fault and resting renderings while the placement still says cloud', async () => {
    for (const connection of [
      { state: EConnectionView.Disconnected, detail: 'did not reopen after 5 attempts' },
      { state: EConnectionView.Parked, detail: null },
    ] as const) {
      const session = sessionOn(connection)
      const { probe } = await mount({ app: appFor(), location: EExecutionLocation.Cloud, session })

      expect(probe.current?.state).toBe(connection.state)
    }
  })

  it('is absent without a session at all', async () => {
    const { probe } = await mount({
      app: appFor(),
      location: EExecutionLocation.Host,
      session: null,
    })

    expect(probe.current).toBeNull()
  })

  it('shows a waking runtime, never a healthy cloud, while the placement says cloud but nothing is attached', async () => {
    const session = sessionOn({ state: EConnectionView.Connected, detail: null })
    const { probe } = await mount({ app: appFor(), location: EExecutionLocation.Cloud, session, attached: false })

    expect(probe.current?.state).toBe(EConnectionView.Waking)
  })
})

describe('the full health the transcript reads', () => {
  it('raises no sticky banner for a disconnected view or a server failure', async () => {
    const app = appFor()
    const channel = fakeCloudChannel({
      connection: { state: EConnectionView.Disconnected, detail: 'did not reopen after 5 attempts' },
    })
    const session = sessionOver(channel)
    const { probe } = await mountHealth({ app, location: EExecutionLocation.Cloud, session })
    await act(async () => {
      channel.fail('workspace failed at git apply')
    })

    expect(probe.current?.failure).toContain('git apply')
    expect(currentNotices().filter((notice) => notice.ttlMs === null)).toEqual([])
  })

  it('reads nothing once the active thread is placed at home, however faulted the last cloud health', async () => {
    const app = appFor()
    const session = sessionOn({ state: EConnectionView.Disconnected, detail: 'did not reopen after 5 attempts' })
    const { probe, root } = await mountHealth({ app, location: EExecutionLocation.Cloud, session })
    await act(async () => {
      await Promise.resolve()
    })

    expect(probe.current?.view.state).toBe(EConnectionView.Disconnected)

    await act(async () => {
      await switchToHostThread(app)
    })

    expect(probe.current).toBeNull()
  })
})

type MountedHealth = {
  setup: TestRendererSetup
  root: Root
  probe: HealthProbe
}

async function mountHealth(args: {
  app: FakeApp
  location: EExecutionLocation
  session: CloudSession | null
  attached?: boolean
}): Promise<MountedHealth> {
  await args.app.threads.create({ id: THREAD, executionLocation: args.location })
  const local = args.app.sessionOwner.require()
  await args.app.executionLocation.activate({ threadId: THREAD, fallback: args.location })
  if (args.location === EExecutionLocation.Cloud && args.attached !== false) {
    await args.app.sessionOwner.adopt({
      threadId: THREAD,
      binding: { kind: ERuntimeKind.Cloud, cwd: '/sandbox', adapters: local.adapters },
    })
  }
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const probe: HealthProbe = { current: undefined }
  await act(async () => {
    root.render(<HealthHarness probe={probe} app={args.app} session={args.session} />)
    await setup.flush()
  })
  await act(async () => {
    await Promise.resolve()
  })
  const mounted = { setup, root, probe }
  liveHealth.push(mounted)
  return mounted
}

const liveHealth: MountedHealth[] = []
