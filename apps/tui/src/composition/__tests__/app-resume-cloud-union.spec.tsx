import { beforeEach, describe, expect, it } from 'bun:test'

import React from 'react'
import { testRender } from '@opentui/react/test-utils'

import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, SessionsClient, type WireThread } from '@dltech/atlas-harness'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { App } from '../app'
import { CLEAN_WORKSPACE, fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory } from '../use-cloud-lift'
import { spokenIn, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, fakeCloud, fakeSignedOutCloud, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

beforeEach(() => {
  dismissNotice()
})

const WIDE = { width: 140, height: 40 }

const RUNNING_STATUS = {
  state: ECloudSandboxState.Running,
  url: 'https://sandbox.example/thread',
} as const

const speaking = (args: { cloud: FakeApp['cloud'] }): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
    cloud: args.cloud,
  })

const wireThread = (args: { id: string; title: string; workspace?: string | undefined }): WireThread => ({
  id: args.id,
  title: args.title,
  head: 1,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  workspace: args.workspace ?? FAKE_CONFIG.cwd,
  repo: null,
  executionLocation: 'cloud',
})

/**
 * The listing's cloud half behind the real SessionsClient: the wire rows a fetch would have parsed,
 * handed back by a fetchFn that never leaves the process, so the spec exercises the union through
 * the same transport the production listing calls.
 */
const cloudWithThreads = (args: { threads: readonly WireThread[]; fail?: boolean }): FakeApp['cloud'] => {
  const fetchFn = (async () => {
    if (args.fail === true) throw new Error('the control plane is unreachable')
    return new Response(JSON.stringify(args.threads), { status: 200 })
  }) as unknown as typeof fetch
  return fakeCloud({
    sessionsClientFor: ({ session }) =>
      new SessionsClient({ url: session.url, token: session.token, fetchFn }),
  })
}

const mount = async (args: { app: FakeApp; bridge: FakeBridge }) => {
  args.bridge.sourceStores({
    log: args.app.log,
    threads: args.app.threads,
    workspace: args.app.workspace.workspace,
  })
  const createBridge: CloudBridgeFactory = () => args.bridge
  const setup = await testRender(
    <App
      app={args.app}
      opened={await spokenIn(args.app)}
      createBridge={createBridge}
      preflightLift={async () => null}
      captureWorkspace={async () => CLEAN_WORKSPACE}
      captureContext={async () => undefined}
    />,
    WIDE,
  )

  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }

  return {
    frame,
    command: async (text: string) => {
      await setup.mockInput.typeText(text)
      setup.mockInput.pressEnter()
      return frame()
    },
    pick: async () => {
      setup.mockInput.pressEnter()
      return frame()
    },
    done: () => teardown(setup),
  }
}

describe('/resume listing local and cloud threads together', () => {
  it('lists only the local store and never asks the cloud when signed out', async () => {
    let listed = 0
    const cloud = fakeSignedOutCloud({})
    const spy = cloud.sessionsClient.bind(cloud)
    cloud.sessionsClient = (args) => {
      listed += 1
      return spy(args)
    }
    const app = speaking({ cloud })
    const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: thread.id, title: 'the host thread' })
    const mounted = await mount({ app, bridge: fakeBridge({ status: RUNNING_STATUS }) })

    try {
      const frame = await mounted.command('/resume')

      expect(frame).toContain('the host thread')
      expect(listed).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows a cloud-only conversation as a cloud stub and attaches to it when picked', async () => {
    const wire = wireThread({ id: 'cloud-thread-7', title: 'the sandbox thread' })
    const app = speaking({ cloud: cloudWithThreads({ threads: [wire] }) })
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    const mounted = await mount({ app, bridge })

    try {
      const frame = await mounted.command('/resume')

      expect(frame).toContain('the sandbox thread')
      expect(frame).toContain('☁ running')

      await mounted.pick()

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(true)
      expect(bridge.attached[0]?.threadId).toBe(toThreadId(wire.id))
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('shows one row for a thread both stores know — the lifted local record wins', async () => {
    const flippedId = toThreadId('the-lifted-thread')
    const app = speaking({
      cloud: cloudWithThreads({ threads: [wireThread({ id: flippedId, title: 'the lifted thread' })] }),
    })
    await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null, id: flippedId })
    await app.threads.chooseExecutionLocation({ threadId: flippedId, location: EExecutionLocation.Cloud })
    await app.threads.rename({ threadId: flippedId, title: 'the lifted thread' })
    const mounted = await mount({ app, bridge: fakeBridge({ status: RUNNING_STATUS }) })

    try {
      const frame = await mounted.command('/resume')

      expect(frame.match(/the lifted thread/g)).toHaveLength(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('still lists the local store when the cloud read fails', async () => {
    const app = speaking({ cloud: cloudWithThreads({ threads: [], fail: true }) })
    const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: thread.id, title: 'the host thread' })
    const mounted = await mount({ app, bridge: fakeBridge({ status: RUNNING_STATUS }) })

    try {
      const frame = await mounted.command('/resume')

      expect(frame).toContain('the host thread')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('sorts the union by updatedAt so a fresh cloud thread outranks an older local one', async () => {
    const app = speaking({
      cloud: cloudWithThreads({
        threads: [wireThread({ id: 'cloud-thread-9', title: 'the fresh sandbox thread' })],
      }),
    })
    const local = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: local.id, title: 'the old host thread' })
    const mounted = await mount({ app, bridge: fakeBridge({ status: RUNNING_STATUS }) })

    try {
      const frame = await mounted.command('/resume')

      const fresh = frame.indexOf('the fresh sandbox thread')
      const stale = frame.indexOf('the old host thread')
      expect(fresh).toBeGreaterThanOrEqual(0)
      expect(stale).toBeGreaterThanOrEqual(0)
      expect(fresh).toBeLessThan(stale)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
