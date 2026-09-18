import { describe, expect, it } from 'bun:test'

import React from 'react'
import { testRender } from '@opentui/react/test-utils'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { ECloudSandboxState } from '../cloud/cloud-bridge'
import { CLEAN_WORKSPACE, fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import type { CloudBridgeFactory } from '../use-cloud-lift'
import { spokenIn, THREAD } from './app-fixture'
import { fakeEventLog, fakeThreadStore, type FakeThreadStore } from './fake-backend'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const WIDE = { width: 140, height: 40 }

const RUNNING_STATUS = {
  state: ECloudSandboxState.Running,
  url: 'https://sandbox.example/thread',
} as const

const speaking = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }) })

const seedCloudThread = async (): Promise<{ threads: FakeThreadStore; threadId: ThreadId }> => {
  const threads = fakeThreadStore({ log: fakeEventLog() })
  const thread = await threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await threads.rename({ threadId: thread.id, title: 'the lifted thread' })
  return { threads, threadId: thread.id }
}

const mount = async (args: {
  app: FakeApp
  bridge: FakeBridge
  opened?: Parameters<typeof App>[0]['opened']
}) => {
  const createBridge: CloudBridgeFactory = () => args.bridge
  const setup = await testRender(
    <App
      app={args.app}
      opened={args.opened ?? (await spokenIn(args.app))}
      createBridge={createBridge}
      captureWorkspace={async () => CLEAN_WORKSPACE}
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
    typeText: (text: string) => setup.mockInput.typeText(text),
    done: () => teardown(setup),
  }
}

describe('opening a conversation that lives in the cloud', () => {
  it('attaches to its sandbox when picked from /resume', async () => {
    const app = speaking()
    const { threads, threadId } = await seedCloudThread()
    const bridge = fakeBridge({ threadStore: threads, status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.command('/resume')
      const frame = await mounted.pick()

      expect(bridge.created).toHaveLength(1)
      expect(bridge.attached).toHaveLength(1)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
      expect(frame).toContain('said inside the sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('attaches when /resume names a cloud conversation by the title the cloud remembers', async () => {
    const app = speaking()
    const { threads, threadId } = await seedCloudThread()
    const bridge = fakeBridge({ threadStore: threads, status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({ app, bridge })

    try {
      const frame = await mounted.command('/resume the-lifted-thread')

      expect(bridge.attached).toHaveLength(1)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
      expect(frame).toContain('said inside the sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('attaches at boot when the session opens on a cloud conversation', async () => {
    const app = speaking()
    const { threads, threadId } = await seedCloudThread()
    const bridge = fakeBridge({ threadStore: threads, status: RUNNING_STATUS })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-cloud'),
      drafts: [{ type: 'user-said', text: 'said inside the sandbox' }],
    })
    const mounted = await mount({
      app,
      bridge,
      opened: {
        threadId,
        events: [],
        turns: [],
        name: null,
        started: true,
        executionLocation: EExecutionLocation.Cloud,
      },
    })

    try {
      const frame = await mounted.frame()

      expect(bridge.created).toHaveLength(1)
      expect(bridge.attached[0]?.threadId).toBe(threadId)
      expect(frame).toContain('said inside the sandbox')
    } finally {
      await mounted.done()
    }
  }, 60_000)
})

describe('coming back to the host', () => {
  it('descends when a local conversation is picked from inside a cloud session', async () => {
    const app = speaking()
    const hostThread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: hostThread.id, title: 'the host thread' })
    await app.log.append({
      threadId: hostThread.id,
      runId: toRunId('run-host'),
      drafts: [{ type: 'user-said', text: 'said on the host' }],
    })
    const bridge = fakeBridge({ status: RUNNING_STATUS })
    const mounted = await mount({ app, bridge })

    try {
      await mounted.command('/container cloud')
      await mounted.command('/resume')
      await mounted.typeText('host')
      const frame = await mounted.pick()

      expect(frame).toContain('said on the host')
      expect(bridge.channel.closed).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
