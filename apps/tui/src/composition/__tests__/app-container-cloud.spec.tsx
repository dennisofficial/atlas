import { describe, expect, it } from 'bun:test'

import React from 'react'
import { testRender } from '@opentui/react/test-utils'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { CloudError, EChannelConnection } from '@dltech/atlas-harness'

import { ECloudSandboxState } from '../cloud/cloud-bridge'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { CLEAN_WORKSPACE, fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory, WorkspaceCapture } from '../use-cloud-lift'
import { spokenIn, REPLY, THINKING, THREAD } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const DIRTY: WorkspaceCapture = async () => ({
  ...CLEAN_WORKSPACE,
  patch: 'diff --git a/src/app.ts b/src/app.ts\n',
})

const speaking = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } }) })

const mount = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  const createBridge: CloudBridgeFactory = () => args.bridge
  const setup = await testRender(
    <App
      app={args.app}
      opened={await spokenIn(args.app)}
      createBridge={createBridge}
      captureWorkspace={DIRTY}
    />,
    { width: 140, height: 40 },
  )

  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }

  return {
    frame,
    run: async (argument: string) => {
      await setup.mockInput.typeText(`/container ${argument}`)
      setup.mockInput.pressEnter()
      return frame()
    },
    done: () => teardown(setup),
  }
}

describe('/container cloud', () => {
  it('transfers, marks the thread cloud and attaches, carrying the workspace with it', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')

      expect(bridge.created).toHaveLength(1)
      expect(bridge.created[0]?.workspace?.branch).toBe('dennis/container-cloud')
      expect(bridge.created[0]?.workspace?.patch).toContain('diff --git')
      expect(bridge.attached).toHaveLength(1)
      expect(app.threads.chosenLocations.at(-1)?.location).toBe(EExecutionLocation.Cloud)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows the cloud pill in the sidebar once attached', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      expect(await mounted.frame()).not.toContain('CLOUD')

      await mounted.run('cloud')
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      expect(await mounted.frame()).toContain('CLOUD')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  /**
   * A parked sandbox is stopped, so no frame ever announces the parking: the socket simply stops
   * coming back, and the control plane is the only thing that can tell resting from broken.
   */
  it('renders a parked sandbox as parked rather than as a failure', async () => {
    const app = speaking()
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Parked } })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      bridge.channel.moveTo({
        state: EChannelConnection.Closed,
        detail: 'the session socket closed and did not reopen after 8 attempts.',
      })

      const frame = await mounted.frame()
      expect(frame).toContain('parked')
      expect(frame).toContain('asleep until the next message')
      expect(frame).not.toContain('not answering')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('re-reads the durable log when the channel cannot resume its delta buffer', async () => {
    const landed = 'the sandbox wrote this while the socket was away'
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })

      await bridge.log.append({
        threadId: THREAD,
        runId: toRunId('run-in-the-sandbox'),
        drafts: [{ type: 'user-said', text: landed }],
      })
      expect(await mounted.frame()).not.toContain(landed)

      bridge.channel.reload({ sinceEventSeq: 0 })

      expect(await mounted.frame()).toContain(landed)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('reads a 503 as the cloud not being set up and stays on the host', async () => {
    const app = speaking()
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 503, message: 'sandboxes are not configured' }),
    })
    const mounted = await mount({ app, bridge })

    try {
      const frame = await mounted.run('cloud')

      expect(frame).toContain('not set up')
      expect(bridge.attached).toEqual([])
      expect(app.executionLocation.current()).toBe(EExecutionLocation.Host)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('a sandbox whose workspace would not materialise', () => {
  it('renders the git step and git’s own words rather than an empty directory', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge })

    try {
      await mounted.run('cloud')
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      bridge.channel.fail(
        'the workspace failed at git apply: error: patch failed: src/app.ts:12',
      )

      const frame = await mounted.frame()
      expect(frame).toContain('git apply')
      expect(frame).toContain('patch failed')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
