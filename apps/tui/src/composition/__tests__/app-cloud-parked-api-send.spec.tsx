import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import {
  ECloudSandboxState,
  EConnectionView,
  ERuntimePhase,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'
import { runtimeCheckpointSchema } from '@dltech/atlas-wire'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { clearAttachFailure } from '../attach-failure'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { cloudAttachmentOf } from '../session-binding'
import { mountCloud } from './app-cloud-archive-fixture'
import { THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const LOCAL_TEXT = 'said before the sandbox parked'
const QUEUED_TEXT = 'queued while the pod sleeps'

const cloudThread = async (app: FakeApp): Promise<ThreadId> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({
    threadId: thread.id,
    location: EExecutionLocation.Cloud,
  })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-before-park'),
    drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
  })
  return thread.id
}

const parkedCheckpoint = (threadId: ThreadId) =>
  runtimeCheckpointSchema.parse({
    threadId,
    runtimeId: 'runtime-1',
    sandboxSessionId: 'sandbox-session-1',
    revision: 4,
    phase: ERuntimePhase.Parked,
    reportedAt: '2026-10-02T00:00:00.000Z',
    transcript: { head: 1, count: 1, digest: transcriptIdentityDigest([]) },
  })

const parkedBridge = async (threadId: ThreadId): Promise<FakeBridge> => {
  const bridge = fakeBridge({
    status: { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
  })
  await bridge.log.append({
    threadId,
    runId: toRunId('run-before-park'),
    drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
  })
  return bridge
}

const mountParked = async (app: FakeApp, bridge: FakeBridge, threadId: ThreadId) => {
  const mounted = await mountCloud({
    app,
    bridge,
    opened: {
      threadId: THREAD,
      events: [],
      turns: [],
      name: null,
      started: false,
      bootCloudThreadId: threadId,
    },
  })
  await mounted.showing(LOCAL_TEXT)
  const connected = await until({
    holds: async () =>
      cloudAttachmentOf(app.sessionOwner.snapshot().binding)?.session.health().view.state ===
      EConnectionView.Connected,
    within: 10_000,
  })
  expect(connected).toBe(true)
  bridge.channel.pushCheckpoint(parkedCheckpoint(threadId))
  bridge.channel.moveTo({ state: EConnectionView.Parked, detail: null })
  await mounted.frame()
  return mounted
}

describe('a composer send on a parked cloud thread', () => {
  it('records the intent through the API lane instead of the local queue', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })
    const threadId = await cloudThread(app)
    const bridge = await parkedBridge(threadId)
    const mounted = await mountParked(app, bridge, threadId)

    const wakesBeforeSend = bridge.created.length
    try {
      await mounted.command(QUEUED_TEXT)

      expect(
        await until({ holds: async () => bridge.sentMessages.length === 1, within: 10_000 }),
      ).toBe(true)
      expect(bridge.sentMessages[0]?.text).toBe(QUEUED_TEXT)
      expect(app.pending.forThread({ threadId }).getSnapshot()).toEqual([])
      expect(await mounted.frame()).toContain(QUEUED_TEXT)
      expect(
        await until({
          holds: async () => bridge.created.length === wakesBeforeSend + 1,
          within: 10_000,
        }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('surfaces a notice and keeps no local queue when the API refuses the send', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })
    const threadId = await cloudThread(app)
    const bridge = await parkedBridge(threadId)
    const mounted = await mountParked(app, bridge, threadId)

    bridge.messages.send = () => Promise.reject(new Error('the API is down'))

    const wakesBeforeSend = bridge.created.length
    try {
      await mounted.command(QUEUED_TEXT)

      expect(
        await until({
          holds: async () =>
            currentNotices().some((notice) => notice.text.includes('could not be queued')),
          within: 10_000,
        }),
      ).toBe(true)
      await mounted.frame()
      expect(app.pending.forThread({ threadId }).getSnapshot()).toEqual([])
      expect(bridge.created.length).toBe(wakesBeforeSend)
      expect(bridge.sentMessages).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
