import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, EConnectionView } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { clearAttachFailure } from '../attach-failure'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { cloudAttachmentOf } from '../session-binding'
import { mountCloud } from './app-cloud-archive-fixture'
import { THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const BEFORE = 'the earlier message'
const STEERED = 'steer the running turn'

const cloudThread = async (app: FakeApp): Promise<ThreadId> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({
    threadId: thread.id,
    location: EExecutionLocation.Cloud,
  })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-1'),
    drafts: [{ type: 'user-said', text: BEFORE }],
  })
  return thread.id
}

describe('a composer send on a connected cloud thread', () => {
  it('goes over the channel, never through the API lane, and starts no wake', async () => {
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' }, perChunkMs: 1 }),
    })
    const threadId = await cloudThread(app)
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-1'),
      drafts: [{ type: 'user-said', text: BEFORE }],
    })
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

    try {
      await mounted.showing(BEFORE)
      expect(
        await until({
          holds: async () =>
            cloudAttachmentOf(app.sessionOwner.snapshot().binding)?.session.health().view.state ===
            EConnectionView.Connected,
          within: 10_000,
        }),
      ).toBe(true)

      const wakesBeforeSend = bridge.created.length
      await mounted.command(STEERED)
      expect(await mounted.showing(STEERED)).toContain(STEERED)

      expect(bridge.sentMessages).toEqual([])
      expect(bridge.created.length).toBe(wakesBeforeSend)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
