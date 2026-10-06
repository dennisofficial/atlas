import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import {
  EChannelConnection,
  ECloudSandboxState,
  ERuntimePhase,
  transcriptIdentityDigest,
  type ParkedTranscriptRecord,
  type RuntimeCheckpoint,
} from '@dltech/atlas-harness'

import { grammarsReady, settle } from '../../ui/markdown/__tests__/harness'
import { clearAttachFailure } from '../attach-failure'
import { dismissNotice } from '../../ui/notice-store'
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

const PARKED = { state: ECloudSandboxState.Parked, url: 'https://sandbox.example/thread' } as const

const LOCAL_TEXT = 'said before the sandbox parked'

const appFor = (): FakeApp => fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })

const parkedThread = async (app: FakeApp): Promise<{ threadId: ThreadId; identity: { head: number; count: number; digest: string } }> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await app.threads.rename({ threadId: thread.id, title: 'the parked thread' })
  const events = await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-before-park'),
    drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
  })
  const parked = await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-before-park'),
    drafts: [
      {
        type: 'parked',
        reason: 'idle',
        turnRunning: false,
        childrenRunning: 0,
        shellsRunning: 0,
        servicesRunning: 0,
        clientsAttached: 0,
      },
    ],
  })
  const transcript = [...events, ...parked]
  return {
    threadId: thread.id,
    identity: { head: transcript.at(-1)?.seq ?? 0, count: transcript.length, digest: transcriptIdentityDigest(transcript) },
  }
}

const checkpointFor = (args: { threadId: ThreadId; identity: { head: number; count: number; digest: string } }): RuntimeCheckpoint => ({
  threadId: args.threadId,
  runtimeId: 'runtime-1',
  sandboxSessionId: 'sandbox-session-1',
  revision: 4,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-02T00:00:00.000Z',
  transcript: args.identity,
})

const bootOn = (threadId: ThreadId) => ({
  threadId: THREAD,
  events: [],
  turns: [],
  name: null,
  started: false,
  bootCloudThreadId: threadId,
})

const healthOf = (app: FakeApp) => cloudAttachmentOf(app.sessionOwner.snapshot().binding)?.session.health()

const bridgeFor = (): FakeBridge => fakeBridge({ status: PARKED })

describe('resuming a parked cloud thread', () => {
  it('renders the local transcript undimmed and wakes nothing when the park record proves it complete', async () => {
    const app = appFor()
    const { threadId, identity } = await parkedThread(app)
    const record: ParkedTranscriptRecord = { checkpoint: checkpointFor({ threadId, identity }), applied: identity }
    await app.threads.writeParkedTranscript({ threadId, record })
    const bridge = bridgeFor()
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      const frame = await mounted.showing(LOCAL_TEXT)

      expect(frame).toContain(LOCAL_TEXT)
      expect(frame).not.toContain('parked after')
      expect(app.sessionOwner.snapshot().bound).toBe(true)
      expect(bridge.created).toHaveLength(0)
      expect(bridge.attached).toHaveLength(0)
      expect(bridge.parkedAttaches).toEqual([threadId])
      expect(bridge.channel.connection().state).toBe(EChannelConnection.Parked)
      expect(healthOf(app)?.stale).toBe(false)
      expect(mounted.mutedEntries()).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('wakes the sandbox on the first send from a synced parked transcript', async () => {
    const app = appFor()
    const { threadId, identity } = await parkedThread(app)
    await app.threads.writeParkedTranscript({
      threadId,
      record: { checkpoint: checkpointFor({ threadId, identity }), applied: identity },
    })
    const bridge = bridgeFor()
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)
      expect(bridge.created).toHaveLength(0)

      await mounted.command('now wake up')

      expect(await until({ holds: async () => bridge.created.length === 1, within: 10_000 })).toBe(true)
      expect(await until({ holds: async () => bridge.channel.woken.length === 1, within: 10_000 })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it.each([
    ['a park record whose applied view is missing', async (app: FakeApp, args: { threadId: ThreadId; identity: { head: number; count: number; digest: string } }) => {
      await app.threads.writeParkedTranscript({
        threadId: args.threadId,
        record: { checkpoint: checkpointFor(args), applied: null },
      })
    }],
    ['no park record at all', async () => undefined],
  ])('renders the transcript dimmed before the background wake lands, given %s', async (_name, seed) => {
    const app = appFor()
    const held = await parkedThread(app)
    await seed(app, held)
    const bridge = bridgeFor()
    const wakeGate = promiseGate()
    const create = bridge.sandboxes.create
    bridge.sandboxes.create = async (given) => {
      await wakeGate.gate
      return create(given)
    }
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(held.threadId) })

    try {
      const frame = await mounted.showing(LOCAL_TEXT)

      expect(frame).toContain(LOCAL_TEXT)
      expect(frame).not.toContain('parked after')
      expect(app.sessionOwner.snapshot().bound).toBe(true)
      expect(bridge.created).toHaveLength(0)
      expect(healthOf(app)?.stale).toBe(true)
      expect(mounted.mutedEntries()).toBeGreaterThan(0)

      wakeGate.release()

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(true)
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)
      expect(await mounted.frame()).toContain(LOCAL_TEXT)
      expect(mounted.mutedEntries()).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('renders the local mirror immediately for a crash-parked session that left no park record', async () => {
    const app = appFor()
    const { threadId } = await parkedThread(app)
    const bridge = bridgeFor()
    const wakeGate = promiseGate()
    const create = bridge.sandboxes.create
    bridge.sandboxes.create = async (given) => {
      await wakeGate.gate
      return create(given)
    }
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      const frame = await mounted.showing(LOCAL_TEXT)

      expect(frame).toContain(LOCAL_TEXT)
      expect(app.sessionOwner.snapshot().bound).toBe(true)
      expect(bridge.created).toHaveLength(0)
      expect(bridge.attached).toHaveLength(0)
      expect(bridge.parkedAttaches).toEqual([threadId])
      expect(healthOf(app)?.stale).toBe(true)
      expect(mounted.mutedEntries()).toBeGreaterThan(0)

      wakeGate.release()

      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('persists the park record with the applied identity when the live session parks', async () => {
    const app = appFor()
    const { threadId, identity } = await parkedThread(app)
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Running, url: PARKED.url } })
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)
      expect(await until({ holds: async () => bridge.attached.length === 1, within: 10_000 })).toBe(true)
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)
      expect(await app.threads.readParkedTranscript({ threadId })).toBeNull()

      bridge.channel.pushCheckpoint(checkpointFor({ threadId, identity }))

      expect(
        await until({ holds: async () => (await app.threads.readParkedTranscript({ threadId })) !== null, within: 10_000 }),
      ).toBe(true)
      const record = await app.threads.readParkedTranscript({ threadId })
      expect(record?.checkpoint.phase).toBe(ERuntimePhase.Parked)
      expect(record?.applied).toEqual(identity)
      await settle(50)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('persists the park record without an applied identity when the checkpoint names a transcript this client never applied', async () => {
    const app = appFor()
    const { threadId, identity } = await parkedThread(app)
    const bridge = fakeBridge({ status: { state: ECloudSandboxState.Running, url: PARKED.url } })
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)

      const ahead = { head: identity.head + 5, count: identity.count + 5, digest: 'f'.repeat(64) }
      bridge.channel.pushCheckpoint(checkpointFor({ threadId, identity: ahead }))

      expect(
        await until({ holds: async () => (await app.threads.readParkedTranscript({ threadId })) !== null, within: 15_000 }),
      ).toBe(true)
      expect((await app.threads.readParkedTranscript({ threadId }))?.applied).toBeNull()
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
