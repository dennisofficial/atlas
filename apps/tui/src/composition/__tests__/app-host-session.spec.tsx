import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { THREADS_HEADING } from '../../ui/components/threads'
import { App } from '../app'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { unstartedConversation } from '../open-conversation'
import { until } from './app-fixture'
import {
  FAKE_CONFIG,
  fakeApp,
  fakeSignedOutCloud,
  scriptedModelPort,
  type FakeApp,
} from './fake-app'

await grammarsReady()

const REPLY = 'the linter is at zero'

const WIDE = { width: 150, height: 40 }

const hostApp = (args: { pods?: boolean } = {}): FakeApp =>
  fakeApp({
    model: scriptedModelPort({ script: { thinking: 'weighing it', reply: REPLY } }),
    cloud: fakeSignedOutCloud(),
    ...(args.pods === true ? { pods: true } : {}),
  })

async function mount(app: FakeApp) {
  const bridge = fakeBridge()
  let preflights = 0
  const setup = await testRender(
    <App
      app={app}
      opened={unstartedConversation({ ids: app.ids })}
      createBridge={() => bridge}
      preflightBirth={async () => {
        preflights += 1
        return null
      }}
    />,
    WIDE,
  )
  const frame = async (): Promise<string> => {
    await setup.flush()
    await settle(250)
    await setup.flush()
    return setup.captureCharFrame()
  }
  const command = async (text: string): Promise<string> => {
    await setup.mockInput.typeText(text)
    setup.mockInput.pressEnter()
    return frame()
  }
  return { setup, bridge, frame, command, preflights: () => preflights }
}

async function seedHostThread(app: FakeApp): Promise<void> {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.rename({ threadId: thread.id, title: 'the old host thread' })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-old'),
    drafts: [{ type: 'user-said', text: 'hi' }],
  })
}

describe('a session with experimental.pods off', () => {
  it('runs the first turn in-process: no sign-in, no preflight, no pod', async () => {
    const app = hostApp()
    const mounted = await mount(app)
    try {
      expect(app.pods).toBe(false)
      expect(app.cloud.session()).toBeNull()
      await mounted.command('take the linter to zero')

      expect(
        await until({ holds: async () => (await mounted.frame()).includes(REPLY), within: 20_000 }),
      ).toBe(true)
      expect(mounted.bridge.created).toEqual([])
      expect(mounted.preflights()).toBe(0)
      expect(app.sessionOwner.placement.of(app.sessionOwner.snapshot().threadId!)).toBe(
        EExecutionLocation.Host,
      )
      expect(await mounted.frame()).not.toContain('sign in to Atlas Cloud')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  it('lists the old host threads in /resume', async () => {
    const app = hostApp()
    await seedHostThread(app)
    const mounted = await mount(app)
    try {
      const frame = await mounted.command('/resume')

      expect(frame).toContain(THREADS_HEADING.toUpperCase())
      expect(frame).toContain('the old host thread')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  it('hides host threads once pods are on', async () => {
    const app = hostApp({ pods: true })
    await seedHostThread(app)
    const mounted = await mount(app)
    try {
      expect(await mounted.command('/resume')).not.toContain('the old host thread')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
