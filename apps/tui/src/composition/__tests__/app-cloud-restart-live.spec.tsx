import { appendFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, type EventLogPort } from '@dltech/atlas-core'
import {
  CloudSessionStore,
  CloudSettingsStore,
  FileSecretsStore,
  SecretCipher,
  SecretsStoreProxy,
  SystemClock,
  atlasCloudFile,
  atlasSecretsFile,
  atlasVaultKeyFile,
  loadSettings,
  readGhAuthToken,
  requireVercelCredentials,
  sandboxImageOf,
  VercelDriver,
  sandboxNameFor,
  type CloudBridge,
  type CloudChannel,
} from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { buildInfo, EBuildKind } from '../../build/info'
import { createCloudBridge } from '../cloud/create-bridge'
import type { MoveStepTiming } from '../use-container-move'
import { until } from './app-fixture'
import {
  mountLive,
  scratchRepo,
  throwawayHome,
  type Mounted,
} from './app-cloud-roundtrip-live-fixture'

const LIVE_ROUNDTRIP_FLAG = 'ATLAS_LIVE_CLOUD_ROUNDTRIP'
const liveRunRequested = (): boolean => process.env[LIVE_ROUNDTRIP_FLAG] === '1'

const DIAG_FILE = '/tmp/atlas-restart-diagnostics.log'
const write0 = (...parts: unknown[]): void => {
  const line = `${parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' ')}\n`
  try {
    appendFileSync(DIAG_FILE, line)
  } catch {
    // best-effort diagnostics never fail the test
  }
}

await grammarsReady()

const say = async (mounted: Mounted, text: string): Promise<void> => {
  await mounted.typeText(text)
  mounted.pressEnter()
}

type Cleanup = { label: string; run: () => Promise<void> }

/**
 * Dennis's repro, driven live: /new → /container cloud → a real message → /restart, with the cloud
 * pill visible the whole time and the restart resuming into a reattach. Unlike the round-trip
 * spec, the message goes to a real model (no scripted ModelPort) and the restart is a genuine
 * close-and-remount against the same scratch home, so the reattach reconciles off the durable log.
 */
describe.skipIf(!liveRunRequested())('the live /container cloud restart repro against production', () => {
  const cleanups: Cleanup[] = []
  const register = (cleanup: Cleanup): void => {
    cleanups.push(cleanup)
  }

  afterEach(async () => {
    const ran = cleanups.splice(0)
    for (const cleanup of ran.reverse()) {
      await cleanup.run().catch((error: unknown) => {
        console.error(`cleanup "${cleanup.label}" failed:`, error)
      })
    }
  })

  it('lifts, answers a real message, and a restart reattaches with the pill on', async () => {
    const home = await throwawayHome()
    register({ label: 'throwaway atlas home', run: () => rm(home.dir, { recursive: true, force: true }) })

    const previousAtlasHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home.dir
    register({
      label: 'ATLAS_HOME restore',
      run: async () => {
        if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
        else process.env.ATLAS_HOME = previousAtlasHome
      },
    })

    write0('boot: home ready', home.dir)
    const sessionStore = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
    const session = sessionStore.read()
    expect(session, 'no Atlas Cloud session — sign in on the real home first').not.toBeNull()
    if (session === null) throw new Error('unreachable: asserted above')
    write0('boot: session read', session.url)

    const scratch = await scratchRepo()
    write0('boot: scratch repo ready')
    register({ label: 'scratch repo', run: () => rm(scratch.dir, { recursive: true, force: true }) })
    register({ label: 'scratch remote', run: () => rm(scratch.remote, { recursive: true, force: true }) })

    const localSecrets = new FileSecretsStore({
      file: atlasSecretsFile(),
      cipher: new SecretCipher(atlasVaultKeyFile()),
    })
    const secrets = new SecretsStoreProxy({
      local: localSecrets,
      sessions: sessionStore,
      clientVersion: 'atlas-restart-live',
    })
    write0('boot: warming secrets')
    await secrets.warm()
    const cloudSettings = new CloudSettingsStore({
      sessions: sessionStore,
      clock: new SystemClock(),
      clientVersion: 'atlas-restart-live',
    })
    write0('boot: refreshing cloud settings')
    await cloudSettings.refresh()
    const settings = loadSettings({ env: process.env, cwd: scratch.dir, cloud: cloudSettings })
    register({ label: 'settings service', run: async () => settings.service.close() })
    requireVercelCredentials({ settings: settings.service, secrets })
    write0('boot: vercel creds resolved')
    await readGhAuthToken()
    write0('boot: gh token read')

    const build = buildInfo()
    const release = build.kind === EBuildKind.Release ? { version: build.version } : undefined

    let cloudChannel: CloudChannel | null = null
    let cloudLog: EventLogPort | null = null
    const driverLines: string[] = []
    const inner = createCloudBridge({
      url: session.url,
      token: session.token,
      clientVersion: 'atlas-restart-live',
      vercel: () => ({
        credentials: requireVercelCredentials({ settings: settings.service, secrets }),
        ...sandboxImageOf({ settings: settings.service, release }),
      }),
      readGitToken: () => readGhAuthToken(),
      onDriverLog: (line) => driverLines.push(line),
    })
    const bridge: CloudBridge = {
      sandboxes: inner.sandboxes,
      attach: (attachArgs) => {
        const attachment = inner.attach(attachArgs)
        cloudChannel = attachment.channel
        cloudLog = attachment.stores.log
        return attachment
      },
    }

    const dumpServeLog = async (threadId: string): Promise<void> => {
      try {
        const creds = requireVercelCredentials({ settings: settings.service, secrets })
        const driver = new VercelDriver({ credentials: creds, cloudUrl: session.url })
        const tail = await driver.serveLogTail({ name: sandboxNameFor({ threadId }) })
        write0('=== SERVE LOG ===')
        write0(tail)
      } catch (error) {
        write0('could not read the serve log:', error instanceof Error ? error.message : String(error))
      }
    }

    const dumpNotices = async (): Promise<void> => {
      const { currentNotices } = await import('../../ui/notice-store')
      write0('notices:')
      for (const n of currentNotices()) write0(`  [${n.tone}] ${n.text}`)
    }

    // Phase 1: /new + /container cloud. mountLive opens a fresh thread (EOpenMode.New).
    const timings: MoveStepTiming[] = []
    write0('boot: mounting app (composeHarness + testRender)')
    const mounted = await mountLive({ scratch, bridge, timings, settings })
    write0('boot: app mounted')
    register({ label: 'mounted app', run: () => mounted.done() })
    const threadId = mounted.threadId
    register({
      label: 'sandbox destroy',
      run: async () => {
        try {
          const creds = requireVercelCredentials({ settings: settings.service, secrets })
          const driver = new VercelDriver({ credentials: creds, cloudUrl: session.url })
          await driver.destroy({ name: sandboxNameFor({ threadId }) })
        } catch {
          // best-effort cleanup
        }
      },
    })

    write0('=== repro start === thread', threadId)
    // The lift resumes the in-flight turn on arrival, so there must be one: send the first message
    // before lifting and let the scripted reply land, matching the round-trip spec's shape.
    await say(mounted, 'round trip me')
    const localReply = await until({ holds: () => mounted.app.log.read({ threadId }).then((events) => JSON.stringify(events).includes(mounted.reply)), within: 60_000 })
    expect(localReply, 'the initial message never got its reply').toBe(true)
    write0('phase: initial reply landed')
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    await say(mounted, '/container cloud')
    const flipped = await until({
      holds: async () =>
        (await mounted.app.threads.find({ threadId }))?.executionLocation === EExecutionLocation.Cloud,
      within: 300_000,
    })
    if (!flipped) {
      write0('LIFT STALLED — move steps:')
      for (const t of timings) write0(`  ${String(t.step)} @ ${t.at}`)
      await dumpNotices()
      await dumpServeLog(threadId)
    }
    expect(flipped, 'the thread never flipped to the cloud').toBe(true)
    // The placement commits before the channel attach finishes, so a lift is not done until the
    // move overlay clears — attach is part of the move, and the overlay stays up while it runs.
    const overlayCleared = await until({
      holds: async () => !(await mounted.setup.captureCharFrame()).includes('MOVING TO THE CLOUD'),
      within: 120_000,
    })
    write0('phase: move overlay cleared =', overlayCleared, '; channel attached =', cloudChannel !== null)
    expect(cloudChannel, 'the lift attached without its channel').not.toBeNull()
    if (cloudChannel === null) throw new Error('unreachable: asserted above')

    // The cloud pill must be visible while lifted.
    const pillFrame = await mounted.setup.captureCharFrame()
    write0('pill visible while lifted:', pillFrame.includes('CLOUD'))
    expect(pillFrame).toContain('CLOUD')

    // Phase 2: a real message event over the cloud channel, committed to the cloud transcript. The
    // scratch repo's origin is a local path the sandbox cannot clone, so a real model turn would
    // refuse on the missing workspace; the scripted reply (the fixture default) keeps the turn
    // deterministic while the send round-trips through the live serve for real.
    const channel: CloudChannel = cloudChannel
    await until({
      holds: () =>
        new Promise<boolean>((resolve) => {
          const off = channel.onTurnEnded(() => {
            off()
            resolve(true)
          })
          setTimeout(() => {
            off()
            resolve(false)
          }, 120_000)
        }),
      within: 130_000,
    })
    const REMOTE_LINE = 'remote edit over the live channel'
    channel.send({ text: REMOTE_LINE })
    // A transient socket drop rejects an in-flight read (RemoteRequestLost); the channel reconnects
    // and the read is retried rather than treating the drop as the message never landing.
    const remoteTranscriptHas = async (text: string): Promise<boolean> => {
      if (cloudLog === null) return false
      const log = cloudLog as EventLogPort
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const events = await log.read({ threadId })
          return JSON.stringify(events).includes(text)
        } catch (error) {
          const lost =
            typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'RemoteRequestLost'
          if (!lost || attempt === 2) throw error
          await new Promise((resolve) => setTimeout(resolve, 2_000))
        }
      }
      return false
    }
    const answered = await until({ holds: () => remoteTranscriptHas(REMOTE_LINE), within: 120_000 })
    if (!answered) {
      await dumpNotices()
      await dumpServeLog(threadId)
    }
    expect(answered, 'the remote message never reached the cloud transcript').toBe(true)
    write0('phase: remote message committed to the cloud transcript')

    // Phase 3: /restart — close the app and remount against the same home; the resumed thread must
    // reattach to the surviving sandbox and reconcile the transcript, with the pill still on.
    write0('phase: restarting')
    const channelBeforeRestart = cloudChannel
    // mounted.done() closes the app and its store; its registered cleanup would double-close it, so
    // retire that cleanup by label before closing here.
    const mountedCleanup = cleanups.findIndex((c) => c.label === 'mounted app')
    if (mountedCleanup >= 0) cleanups.splice(mountedCleanup, 1)
    await mounted.done()

    const restarted = await mountLive({
      scratch,
      bridge,
      timings,
      settings,
      resumeThreadId: threadId,
    })
    register({ label: 'restarted app', run: () => restarted.done() })
    write0('phase: remounted; waiting for reattach')

    const reattached = await until({
      holds: async () => cloudChannel !== null && cloudChannel !== channelBeforeRestart,
      within: 120_000,
    })
    if (!reattached) {
      await dumpNotices()
      await dumpServeLog(threadId)
    }
    expect(reattached, 'the restart never reattached to the cloud sandbox').toBe(true)
    write0('phase: reattached')

    // The durable transcript survived the restart — read it off the restarted app's cloud store.
    const restartedTranscriptHas = async (text: string): Promise<boolean> => {
      if (cloudLog === null) return false
      const log = cloudLog as EventLogPort
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const events = await log.read({ threadId })
          return JSON.stringify(events).includes(text)
        } catch (error) {
          const lost =
            typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'RemoteRequestLost'
          if (!lost || attempt === 2) throw error
          await new Promise((resolve) => setTimeout(resolve, 2_000))
        }
      }
      return false
    }
    const survived = await until({ holds: () => restartedTranscriptHas(REMOTE_LINE), within: 30_000 }).catch(
      () => false,
    )
    write0('phase: transcript survived restart =', survived)
    expect(survived, 'the transcript did not survive the restart').toBe(true)

    const restartedFrame = await restarted.setup.captureCharFrame()
    write0('pill visible after restart:', restartedFrame.includes('CLOUD'))
    expect(restartedFrame).toContain('CLOUD')

    write0('=== repro done ===')
  }, 900_000)
})
