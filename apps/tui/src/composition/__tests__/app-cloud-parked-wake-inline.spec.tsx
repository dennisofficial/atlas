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
import { dismissNotice } from '../../ui/notice-store'
import { clearAttachFailure } from '../attach-failure'
import { bootBlocks } from '../boot-block-store'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { cloudAttachmentOf } from '../session-binding'
import { mountCloud } from './app-cloud-archive-fixture'
import { promiseGate, THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const WAKE_HEADING = 'Waking the pod'
const LOCAL_TEXT = 'said before the sandbox parked'

const cloudThread = async (app: FakeApp): Promise<ThreadId> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({
    threadId: thread.id,
    location: EExecutionLocation.Cloud,
  })
  await app.threads.rename({ threadId: thread.id, title: 'the cloud thread' })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-before-park'),
    drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
  })
  return thread.id
}

const gateNextCreate = (bridge: FakeBridge): { release: () => void } => {
  const gate = promiseGate()
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = async (given) => {
    bridge.sandboxes.create = create
    await gate.gate
    return create(given)
  }
  return gate
}

describe('a composer send on a parked cloud thread', () => {
  it('shows the waking block with the composer usable, then clears it once the wake settles', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })
    const threadId = await cloudThread(app)
    const parked = runtimeCheckpointSchema.parse({
      threadId,
      runtimeId: 'runtime-1',
      sandboxSessionId: 'sandbox-session-1',
      revision: 4,
      phase: ERuntimePhase.Parked,
      reportedAt: '2026-10-02T00:00:00.000Z',
      transcript: { head: 1, count: 1, digest: transcriptIdentityDigest([]) },
    })
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' },
    })
    await bridge.log.append({
      threadId,
      runId: toRunId('run-before-park'),
      drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
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
    const viewOf = () =>
      cloudAttachmentOf(app.sessionOwner.snapshot().binding)?.session.health().view

    try {
      await mounted.showing(LOCAL_TEXT)
      expect(
        await until({
          holds: async () => viewOf()?.state === EConnectionView.Connected,
          within: 10_000,
        }),
      ).toBe(true)

      bridge.channel.pushCheckpoint(parked)
      bridge.channel.moveTo({ state: EConnectionView.Parked, detail: null })
      await mounted.frame()
      expect(await mounted.frame()).not.toContain(WAKE_HEADING)

      const wake = gateNextCreate(bridge)
      await mounted.command('hello again')

      const waking = await mounted.showing(WAKE_HEADING)
      expect(waking).toContain('hello again')
      expect(bootBlocks(app).inFlight({ threadId })).toBe(true)

      await mounted.type('still typing')
      expect(await mounted.frame()).toContain('still typing')

      wake.release()
      expect(
        await until({
          holds: async () => !(await mounted.frame()).includes(WAKE_HEADING),
          within: 20_000,
        }),
      ).toBe(true)
      expect(bootBlocks(app).snapshot()).toBeNull()
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
