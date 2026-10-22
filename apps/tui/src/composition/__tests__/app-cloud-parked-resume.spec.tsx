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

describe('opening a cloud thread whose transcript this machine holds', () => {
  it('renders at once and wakes nothing when the lifecycle record says parked', async () => {
    const app = appFor()
    const threadId = await cloudThread(app)
    const bridge = bridgeAt({ threadId, phase: ERuntimePhase.Parked })
    const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

    try {
      const frame = await mounted.showing(LOCAL_TEXT)
      await mounted.frame()

      expect(frame).toContain(LOCAL_TEXT)
      expect(app.sessionOwner.snapshot().bound).toBe(true)
      expect(bridge.created).toHaveLength(0)
      expect(bridge.attached).toHaveLength(0)
      expect(bridge.parkedAttaches).toEqual([threadId])
      expect(bridge.channel.observed.map((checkpoint) => checkpoint.phase)).toEqual([
        ERuntimePhase.Parked,
      ])
      expect(viewOf(app)?.state).toBe(EConnectionView.Parked)
      expect(mounted.mutedEntries()).toBe(0)
      expect(cloudNotices()).toEqual([])
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('wakes the parked sandbox on the first send', async () => {
    const app = appFor()
    const threadId = await cloudThread(app)
    const bridge = bridgeAt({ threadId, phase: ERuntimePhase.Parked })
    const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)
      await mounted.frame()
      expect(bridge.created).toHaveLength(0)

      await mounted.command('now wake up')

      expect(await until({ holds: async () => bridge.created.length === 1, within: 10_000 })).toBe(
        true,
      )
      expect(
        await until({ holds: async () => bridge.channel.woken.length === 1, within: 10_000 }),
      ).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it.each([
    ['a serving record', ERuntimePhase.Serving],
    ['no record at all', null],
  ])(
    'wakes in the background given %s, Waking until the sandbox answers, then Connected',
    async (_name, phase) => {
      const app = appFor()
      const threadId = await cloudThread(app)
      const bridge = bridgeAt({ threadId, phase })
      const wake = gateCreate(bridge)
      const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

      try {
        const frame = await mounted.showing(LOCAL_TEXT)
        expect(frame).toContain(LOCAL_TEXT)
        expect(
          await until({
            holds: async () => viewOf(app)?.state === EConnectionView.Waking,
            within: 10_000,
          }),
        ).toBe(true)
        expect(bridge.attached).toHaveLength(0)

        wake.release()

        expect(
          await until({ holds: async () => bridge.attached.length === 1, within: 10_000 }),
        ).toBe(true)
        expect(
          await until({
            holds: async () => viewOf(app)?.state === EConnectionView.Connected,
            within: 10_000,
          }),
        ).toBe(true)
        expect(bridge.created).toHaveLength(1)
        expect(await mounted.frame()).toContain(LOCAL_TEXT)
      } finally {
        await mounted.done()
      }
    },
    60_000,
  )

  it('reads Disconnected with the reason and a passing notice when the background wake fails — never a sticky banner', async () => {
    const app = appFor()
    const threadId = await cloudThread(app)
    const bridge = fakeBridge({
      status: { state: ECloudSandboxState.Running, url: SANDBOX_URL },
      createFails: new Error('the sandbox would not start'),
    })
    const mounted = await mountCloud({ app, bridge, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)

      expect(
        await until({
          holds: async () => viewOf(app)?.state === EConnectionView.Disconnected,
          within: 10_000,
        }),
      ).toBe(true)
      expect(viewOf(app)?.detail).toContain('the sandbox would not start')
      expect(currentNotices().map((notice) => notice.key)).toContain(CLOUD_WAKE_FAILED_NOTICE_KEY)
      await mounted.frame()
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
