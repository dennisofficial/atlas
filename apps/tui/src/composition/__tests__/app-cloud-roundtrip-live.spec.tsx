import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import {
  CloudSessionStore,
  FileSecretsStore,
  SecretCipher,
  atlasCloudFile,
  atlasSecretsFile,
  atlasVaultKeyFile,
  loadSettings,
  readGhAuthToken,
  requireVercelCredentials,
  sandboxImageOf,
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

    const secrets = new FileSecretsStore({
      file: atlasSecretsFile(),
      cipher: new SecretCipher(atlasVaultKeyFile()),
    })
    const settings = loadSettings({ env: process.env, cwd: scratch.dir })
    register({ label: 'settings service', run: async () => settings.service.close() })
    requireVercelCredentials({ settings: settings.service, secrets })
    await readGhAuthToken()

    const build = buildInfo()
    const release =
      build.kind === EBuildKind.Release && build.buildSha !== null
        ? { version: build.version, buildSha: build.buildSha }
        : undefined

    let cloudChannel: CloudChannel | null = null
    const driverLines: string[] = []
    const inner = createCloudBridge({
      url: session.url,
      token: session.token,
      clientVersion: 'atlas-roundtrip-live',
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

    await say(mounted, 'round trip me')
    expect(await until({ holds: () => transcriptHas(mounted.reply), within: 60_000 })).toBe(true)

    await say(mounted, '/container cloud')
    expect(
      await until({
        holds: async () =>
          (await mounted.app.threads.find({ threadId: mounted.threadId }))?.executionLocation ===
          EExecutionLocation.Cloud,
        within: 300_000,
      }),
      'the thread never flipped to the cloud',
    ).toBe(true)

    expect(await transcriptHas(mounted.reply)).toBe(true)

    /**
     * There is no general file-write op on the wire — serve answers reads, roster, rewind and the
     * archive — so the remote side of the round trip is a conversation event: a `send` the sandbox
     * commits to its own log. The workspace half the descend merges is the dirty tree the lift
     * captured; the remote edit proves the transcript came home from the cloud copy, not the local.
     */
    if (cloudChannel === null) throw new Error('the lift attached without its channel')
    const channel: CloudChannel = cloudChannel
    channel.send({ text: REMOTE_EDIT })
    expect(await until({ holds: () => transcriptHas(REMOTE_EDIT), within: 60_000 })).toBe(true)

    await say(mounted, '/container host')
    expect(
      await until({
        holds: async () =>
          (await mounted.app.threads.find({ threadId: mounted.threadId }))?.executionLocation ===
          EExecutionLocation.Host,
        within: 300_000,
      }),
      'the thread never came home',
    ).toBe(true)
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

    console.log('move step timings:')
    for (const timing of timings) {
      console.log(`  ${String(timing.step)} @ ${timing.at}`)
    }
    console.log(`driver provision lines: ${driverLines.length}`)
  }, 900_000)
})
