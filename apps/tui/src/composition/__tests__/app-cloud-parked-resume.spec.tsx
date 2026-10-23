import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import {
  EConnectionView,
  ECloudSandboxState,
  ERuntimePhase,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'
import { runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { clearAttachFailure } from '../attach-failure'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { CLOUD_WAKE_FAILED_NOTICE_KEY } from '../cloud/cloud-session'
import { CLOUD_BIRTH_NOTICE_KEY } from '../cloud/cloud-birth-notices'
import { CLOUD_SERVER_FAILURE_NOTICE_KEY } from '../use-cloud-connection'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { LOADING_TRANSCRIPT_LABEL } from '../../ui/components/transcript-loading'
import { cloudAttachmentOf } from '../session-binding'
import { mountCloud } from './app-cloud-archive-fixture'
import { promiseGate, THREAD, until } from './app-fixture'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const SANDBOX_URL = 'https://sandbox.example/thread'

const LOCAL_TEXT = 'said before the sandbox parked'

const appFor = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })

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

const checkpointAt = (args: { threadId: ThreadId; phase: ERuntimePhase }): RuntimeCheckpoint =>
  runtimeCheckpointSchema.parse({
    threadId: args.threadId,
    runtimeId: 'runtime-1',
    sandboxSessionId: 'sandbox-session-1',
    revision: 4,
    phase: args.phase,
    reportedAt: '2026-10-02T00:00:00.000Z',
    transcript: { head: 1, count: 1, digest: transcriptIdentityDigest([]) },
  })

const bootOn = (threadId: ThreadId) => ({
  threadId: THREAD,
  events: [],
  turns: [],
  name: null,
  started: false,
  bootCloudThreadId: threadId,
})

const viewOf = (app: FakeApp) =>
  cloudAttachmentOf(app.sessionOwner.snapshot().binding)?.session.health().view

const stickyNotices = (): readonly string[] =>
  currentNotices()
    .filter((notice) => notice.ttlMs === null)
    .map((notice) => notice.key)

const CLOUD_NOTICE_KEYS: ReadonlySet<string> = new Set([
  CLOUD_WAKE_FAILED_NOTICE_KEY,
  CLOUD_SERVER_FAILURE_NOTICE_KEY,
  CLOUD_BIRTH_NOTICE_KEY,
])

const cloudNotices = (): readonly string[] =>
  currentNotices()
    .map((notice) => notice.key)
    .filter((key) => CLOUD_NOTICE_KEYS.has(key))

const bridgeAt = (args: { threadId: ThreadId; phase: ERuntimePhase | null }): FakeBridge =>
  fakeBridge({
    status: {
      state:
        args.phase === ERuntimePhase.Parked
          ? ECloudSandboxState.Parked
          : ECloudSandboxState.Running,
      url: SANDBOX_URL,
    },
    ...(args.phase === null
      ? {}
      : { checkpoint: checkpointAt({ threadId: args.threadId, phase: args.phase }) }),
  })

const gateCreate = (bridge: FakeBridge): { release: () => void } => {
  const gate = promiseGate()
  const create = bridge.sandboxes.create
  bridge.sandboxes.create = async (given) => {
    await gate.gate
    return create(given)
  }
  return gate
}

const seedRemote = async (args: { app: FakeApp; bridge: FakeBridge; threadId: ThreadId }) => {
  const local = await args.app.threads.find({ threadId: args.threadId })
  args.bridge.threads.seedThread({
    id: args.threadId,
    head: 1,
    createdAt: local?.createdAt ?? '',
    updatedAt: local?.updatedAt ?? '',
    workspace: FAKE_CONFIG.cwd,
    repo: null,
    title: 'the cloud thread',
    executionLocation: EExecutionLocation.Cloud,
  })
  await args.bridge.log.append({
    threadId: args.threadId,
    runId: toRunId('run-before-park'),
    drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
  })
}

describe('opening a parked cloud thread', () => {
  it.each([
    ['a parked record', ERuntimePhase.Parked],
    ['a serving record', ERuntimePhase.Serving],
    ['no record at all', null],
  ])(
    'shows the loading line, never a blank screen, then the transcript the sandbox serves given %s',
    async (_name, phase) => {
      const app = appFor()
      const threadId = await cloudThread(app)
      const bridge = bridgeAt({ threadId, phase })
      await seedRemote({ app, bridge, threadId })
      const wake = gateCreate(bridge)
      const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

      try {
        const loading = await mounted.showing(LOADING_TRANSCRIPT_LABEL)
        expect(loading).not.toContain(LOCAL_TEXT)

        wake.release()

        const frame = await mounted.showing(LOCAL_TEXT)
        expect(frame).not.toContain(LOADING_TRANSCRIPT_LABEL)
        expect(bridge.created).toHaveLength(1)
        expect(bridge.parkedAttaches).toEqual([])
        expect(
          await until({
            holds: async () => viewOf(app)?.state === EConnectionView.Connected,
            within: 10_000,
          }),
        ).toBe(true)
      } finally {
        await mounted.done()
      }
    },
    60_000,
  )

  it('reads disconnected with the reason when the wake fails — never a sticky banner', async () => {
    const app = appFor()
    const threadId = await cloudThread(app)
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Running, url: SANDBOX_URL },
      createFails: new Error('the sandbox would not start'),
    })
    const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

    try {
      const frame = await mounted.showing('the sandbox would not start')
      expect(frame).toContain('disconnected')
      expect(frame).not.toContain(LOADING_TRANSCRIPT_LABEL)
      expect(
        currentNotices().some(
          (notice) =>
            notice.key === 'cloud-open-failed' &&
            notice.text.includes('the sandbox would not start'),
        ),
      ).toBe(true)
      expect(stickyNotices()).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('posts no notice at all when a live session parks', async () => {
    const app = appFor()
    const threadId = await cloudThread(app)
    const bridge = bridgeAt({ threadId, phase: ERuntimePhase.Serving })
    const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)
      expect(
        await until({
          holds: async () => viewOf(app)?.state === EConnectionView.Connected,
          within: 10_000,
        }),
      ).toBe(true)
      dismissNotice()

      bridge.channel.pushCheckpoint(checkpointAt({ threadId, phase: ERuntimePhase.Parked }))
      bridge.channel.moveTo({ state: EConnectionView.Parked, detail: null })
      await mounted.frame()

      expect(viewOf(app)?.state).toBe(EConnectionView.Parked)
      expect(cloudNotices()).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
