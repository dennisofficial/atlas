import { appendFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

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
  sandboxNameFor,
  sandboxServeTokenFor,
  VercelDriver,
  type CloudBridge,
  type CloudChannel,
} from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { buildInfo, EBuildKind } from '../../build/info'
import { createCloudBridge } from '../cloud/create-bridge'
import type { MoveStepTiming } from '../use-container-move'
import { until } from './app-fixture'
import {
  FILE,
  LOCAL_EDIT,
  REMOTE_EDIT,
  git,
  mountLive,
  scratchRepo,
  throwawayHome,
  type Mounted,
} from './app-cloud-roundtrip-live-fixture'

export const LIVE_ROUNDTRIP_FLAG = 'ATLAS_LIVE_CLOUD_ROUNDTRIP'

const liveRunRequested = (): boolean => process.env[LIVE_ROUNDTRIP_FLAG] === '1'

// Diagnostics go to a file, not the console — testRender patches the process streams, so neither
// console.log nor process.stderr.write reaches the test output; an appended file always survives.
const DIAG_FILE = '/tmp/atlas-roundtrip-diagnostics.log'
const write0 = (...parts: unknown[]): void => {
  const line = `${parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' ')}\n`
  try {
    appendFileSync(DIAG_FILE, line)
  } catch {
    // best-effort diagnostics never fail the test
  }
}

await grammarsReady()

const expectGit = async (args: readonly string[], cwd: string): Promise<string> => {
  const run = await git(args, cwd)
  expect(run.ok, `git ${args.join(' ')} failed: ${run.stderr}`).toBe(true)
  return run.stdout
}

const say = async (mounted: Mounted, text: string): Promise<void> => {
  await mounted.typeText(text)
  mounted.pressEnter()
}

type Cleanup = { label: string; run: () => Promise<void> }

describe.skipIf(!liveRunRequested())('the live lift to descend round trip against production', () => {
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

  it('lifts a dirty workspace, edits remotely, and descends with both edits uncommitted', async () => {
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

    const session = new CloudSessionStore({
      file: atlasCloudFile(),
      keyFile: atlasVaultKeyFile(),
    }).read()
    expect(session, 'no Atlas Cloud session — sign in on the real home first').not.toBeNull()
    if (session === null) throw new Error('unreachable: asserted above')

    const scratch = await scratchRepo()
    register({ label: 'scratch repo', run: () => rm(scratch.dir, { recursive: true, force: true }) })
    register({ label: 'scratch remote', run: () => rm(scratch.remote, { recursive: true, force: true }) })

    // Secrets and the cloud-layer settings (the Vercel team/project IDs) are cloud-backed when
    // signed in: the local copies were wiped in a past smoke test, so read both through the
    // cloud-backed stores, warmed, exactly as the running TUI does.
    const sessionStore = new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() })
    const localSecrets = new FileSecretsStore({
      file: atlasSecretsFile(),
      cipher: new SecretCipher(atlasVaultKeyFile()),
    })
    const secrets = new SecretsStoreProxy({
      local: localSecrets,
      sessions: sessionStore,
      clientVersion: 'atlas-roundtrip-live',
    })
    await secrets.warm()
    const cloudSettings = new CloudSettingsStore({
      sessions: sessionStore,
      clock: new SystemClock(),
      clientVersion: 'atlas-roundtrip-live',
    })
    await cloudSettings.refresh()
    const settings = loadSettings({ env: process.env, cwd: scratch.dir })
    register({ label: 'settings service', run: async () => settings.service.close() })
    requireVercelCredentials({ settings: settings.service, secrets })
    await readGhAuthToken()

    const build = buildInfo()
    const release = build.kind === EBuildKind.Release ? { version: build.version } : undefined

    let cloudChannel: CloudChannel | null = null
    let cloudLog: EventLogPort | null = null
    const driverLines: string[] = []
    const inner = createCloudBridge({
      vercel: () => ({
        credentials: requireVercelCredentials({ settings: settings.service, secrets }),
        ...sandboxImageOf({ settings: settings.service, release }),
      }),
      attachmentToken: ({ threadId }) => sandboxServeTokenFor({ secrets, threadId }),
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

    const timings: MoveStepTiming[] = []
    const mounted = await mountLive({ scratch, bridge, timings, settings })
    register({ label: 'mounted app', run: () => mounted.done() })

    let descended = false
    register({
      label: 'sandbox destroy',
      run: async () => {
        if (descended) return
        await bridge.sandboxes.destroy({ threadId: mounted.threadId })
      },
    })

    const transcriptHas = async (text: string): Promise<boolean> => {
      const events = await mounted.app.log.read({ threadId: mounted.threadId })
      return JSON.stringify(events).includes(text)
    }

    // While lifted, the transcript lives on the cloud (the drive); the local log is the pre-lift
    // copy. The remote edit is committed to the cloud log, so it must be read through the attached
    // cloud stores — the local log only gains it when the descend brings the archive home. A
    // transient socket drop rejects an in-flight read (RemoteRequestLost); the channel reconnects
    // and the read is retried rather than treating the drop as the edit never landing.
    const remoteTranscriptHas = async (text: string): Promise<boolean> => {
      if (cloudLog === null) return false
      const log = cloudLog as EventLogPort
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const events = await log.read({ threadId: mounted.threadId })
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

    write0('=== round-trip start ===')
    await say(mounted, 'round trip me')
    write0('phase: sent initial message, waiting for reply')
    expect(await until({ holds: () => transcriptHas(mounted.reply), within: 60_000 })).toBe(true)
    write0('phase: reply landed')
    // Let the turn settle fully so the lift is not mid-turn: the assistant reply lands in the log
    // before the loop unwinds, and a lift fired in that window takes the pause path instead of the
    // clean settle path. The remote-edit half of this round trip needs the deterministic one.
    await new Promise((resolve) => setTimeout(resolve, 3_000))

    write0('phase: sending /container cloud')
    await say(mounted, '/container cloud')
    const flipped = await until({
      holds: async () =>
        (await mounted.app.threads.find({ threadId: mounted.threadId }))?.executionLocation ===
        EExecutionLocation.Cloud,
      within: 300_000,
    })
    if (!flipped) {
      write0('LIFT STALLED — move steps reached:')
      for (const timing of timings) write0(`  ${String(timing.step)} @ ${timing.at}`)
      write0(`driver provision lines (${driverLines.length}):`)
      for (const line of driverLines) write0(`  ${line}`)
      const thread = await mounted.app.threads.find({ threadId: mounted.threadId })
      write0('thread executionLocation:', thread?.executionLocation)
      const { currentNotices } = await import('../../ui/notice-store')
      write0('notices:')
      for (const n of currentNotices()) write0(`  [${n.tone}] ${n.text}`)
      // The serve log on the sandbox is the ground truth for a boot that never went healthy.
      try {
        const creds = requireVercelCredentials({ settings: settings.service, secrets })
        const driver = new VercelDriver({ credentials: creds, cloudUrl: session.url })
        const tail = await driver.serveLogTail({
          name: sandboxNameFor({ threadId: mounted.threadId }),
        })
        write0('=== SERVE LOG ===')
        write0(tail)
      } catch (error) {
        write0('could not read the serve log:', error instanceof Error ? error.message : String(error))
      }
    }
    write0('phase: flip wait returned, flipped =', flipped)
    expect(flipped, 'the thread never flipped to the cloud').toBe(true)
    write0('phase: flipped to cloud; channel attached =', cloudChannel !== null)

    expect(await transcriptHas(mounted.reply)).toBe(true)

    /**
     * There is no general file-write op on the wire — serve answers reads, roster, rewind and the
     * archive — so the remote side of the round trip is a conversation event: a `send` the sandbox
     * commits to its own log. The workspace half the descend merges is the dirty tree the lift
     * captured; the remote edit proves the transcript came home from the cloud copy, not the local.
     */
    if (cloudChannel === null) {
      const { currentNotices } = await import('../../ui/notice-store')
      write0('LIFT ATTACHED WITHOUT CHANNEL — notices:')
      for (const n of currentNotices()) write0(`  [${n.tone}] ${n.text}`)
      write0('move steps:')
      for (const timing of timings) write0(`  ${String(timing.step)} @ ${timing.at}`)
      throw new Error('the lift attached without its channel')
    }
    const channel: CloudChannel = cloudChannel
    // The lift resumes the in-flight turn on arrival; sending before that resume settles races the
    // said against the running loop. Wait for the resumed turn to end before the remote edit.
    await until({
      holds: () =>
        new Promise<boolean>((resolve) => {
          const unsubscribe = channel.onTurnEnded(() => {
            unsubscribe()
            resolve(true)
          })
          setTimeout(() => {
            unsubscribe()
            resolve(false)
          }, 120_000)
        }),
      within: 130_000,
    })
    write0('phase: resume settled; sending remote edit')
    channel.send({ text: REMOTE_EDIT })
    const editLanded = await until({ holds: () => remoteTranscriptHas(REMOTE_EDIT), within: 60_000 })
    write0('phase: remote edit landed =', editLanded)
    if (!editLanded) {
      write0('channel connection after send wait:', JSON.stringify(channel.connection()))
    }
    expect(editLanded, 'the remote edit never reached the cloud transcript').toBe(true)

    write0('phase: sending /container host (descend)')
    await say(mounted, '/container host')
    const cameHome = await until({
      holds: async () =>
        (await mounted.app.threads.find({ threadId: mounted.threadId }))?.executionLocation ===
        EExecutionLocation.Host,
      within: 300_000,
    })
    write0('phase: descend wait returned, cameHome =', cameHome)
    expect(cameHome, 'the thread never came home').toBe(true)
    descended = true

    expect(await transcriptHas(mounted.reply)).toBe(true)
    expect(await transcriptHas(REMOTE_EDIT)).toBe(true)

    const landed = await readFile(join(scratch.dir, FILE), 'utf8')
    expect(landed).toContain(LOCAL_EDIT)

    const status = await expectGit(['status', '--porcelain'], scratch.dir)
    expect(status.trim().length > 0, 'the edits came home committed').toBe(true)
    const log = await expectGit(['log', '--oneline'], scratch.dir)
    expect(log).not.toContain(LOCAL_EDIT)
    expect(log).not.toContain(REMOTE_EDIT)

    write0('move step timings:')
    for (const timing of timings) {
      write0(`  ${String(timing.step)} @ ${timing.at}`)
    }
    write0(`driver provision lines: ${driverLines.length}`)
  }, 900_000)
})
