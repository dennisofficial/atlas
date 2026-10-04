import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, type ThreadId } from '@dltech/atlas-core'
import {
  EChannelConnection,
  ECloudSandboxState,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
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

const RUNNING = { state: ECloudSandboxState.Running, url: 'https://sandbox.example/thread' } as const

const LOCAL_TEXT = 'said while the sandbox ran'

const appFor = (): FakeApp => fakeApp({ model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }) })

const runningThread = async (app: FakeApp): Promise<ThreadId> => {
  const thread = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
  await app.threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Cloud })
  await app.threads.rename({ threadId: thread.id, title: 'the running thread' })
  await app.log.append({
    threadId: thread.id,
    runId: toRunId('run-before-restart'),
    drafts: [{ type: 'user-said', text: LOCAL_TEXT }],
  })
  return thread.id
}

const bootOn = (threadId: ThreadId) => ({
  threadId: THREAD,
  events: [],
  turns: [],
  name: null,
  started: false,
  bootCloudThreadId: threadId,
})

const healthOf = (app: FakeApp) => cloudAttachmentOf(app.sessionOwner.snapshot().binding)?.session.health()

const bridgeFor = (): FakeBridge => fakeBridge({ status: RUNNING })

/**
 * The wake re-attach a `/restart` performs: the fresh socket greets and the serve — on the new
 * build — vouches the log is current. Nothing about the transcript changed while the client
 * reconnected, so it must never render dimmed.
 */
describe('a restarted running cloud thread', () => {
  it('never dims the transcript once the serve vouches the log across the re-attach', async () => {
    const app = appFor()
    const threadId = await runningThread(app)
    const bridge = bridgeFor()
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      const frame = await mounted.showing(LOCAL_TEXT)
      expect(frame).toContain(LOCAL_TEXT)
      expect(app.sessionOwner.snapshot().bound).toBe(true)

      // The serve's greet vouches the log is current — the new build's Ready carries the flag.
      bridge.channel.ready({ turnInFlight: false, transcriptCurrent: true })
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)
      expect(await until({ holds: async () => mounted.mutedEntries() === 0, within: 10_000 })).toBe(true)

      // The `/restart` wake re-attach closes the socket on purpose; the vouched log is no less
      // correct for it, so the transcript never dims.
      bridge.channel.moveTo({ state: EChannelConnection.Connecting, detail: null })
      await mounted.frame()
      expect(healthOf(app)?.stale).toBe(false)

      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      bridge.channel.ready({ turnInFlight: false, transcriptCurrent: true })
      await mounted.frame()

      expect(healthOf(app)?.stale).toBe(false)
      expect(mounted.mutedEntries()).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('dims until the reconnect vouches when the socket drops uncleanly', async () => {
    const app = appFor()
    const threadId = await runningThread(app)
    const bridge = bridgeFor()
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)
      bridge.channel.ready({ turnInFlight: false, transcriptCurrent: true })
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)

      // The socket died on its own — the serve may have appended while no wire carried it.
      bridge.channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
      expect(await until({ holds: async () => healthOf(app)?.stale === true, within: 10_000 })).toBe(true)
      expect(await until({ holds: async () => mounted.mutedEntries() > 0, within: 10_000 })).toBe(true)

      // The reconnect's ready vouches again, and the dim clears.
      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      bridge.channel.ready({ turnInFlight: false, transcriptCurrent: true })
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)
      expect(await until({ holds: async () => mounted.mutedEntries() === 0, within: 10_000 })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('a ready that carries no vouch proves nothing on its own, even while open', async () => {
    const app = appFor()
    const threadId = await runningThread(app)
    const bridge = bridgeFor()
    const mounted = await mountCloud({ app, bridge, withArchive: false, opened: bootOn(threadId) })

    try {
      await mounted.showing(LOCAL_TEXT)

      // The socket drops and reconnects; the serve that answers is an old build whose Ready has no
      // transcriptCurrent field, so the reconnect alone must not undim.
      bridge.channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
      expect(await until({ holds: async () => healthOf(app)?.stale === true, within: 10_000 })).toBe(true)

      bridge.channel.moveTo({ state: EChannelConnection.Open, detail: null })
      bridge.channel.ready({ turnInFlight: false })
      await mounted.frame()
      expect(healthOf(app)?.stale).toBe(true)

      // Only the reload-driven resync — the pre-vouch path — proves currency.
      bridge.channel.reload({ sinceEventSeq: 0 })
      expect(await until({ holds: async () => healthOf(app)?.stale === false, within: 10_000 })).toBe(true)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
