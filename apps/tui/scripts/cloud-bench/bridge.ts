import type { ThreadId } from '@dltech/atlas-core'
import {
  createLocalCloudBridge,
  driveNameFor,
  liveSdk,
  sandboxNameFor,
  type CloudAttachment,
  type CloudBridge,
  type VercelDriver,
  type VercelSandboxConfig,
} from '@dltech/atlas-harness'
import { liveDriveSdk } from '../../../../packages/harness/src/cloud/drive-lifecycle'
import { liveBridgeOptionsFor } from '../../src/composition/live-cloud'
import type { AtlasApp } from '../../src/composition/compose'
import { BenchmarkDriver } from './bench-driver'
import { parseBakedRuntime, type BakedRuntime } from './runtime'
import { teardownUntilAbsent, type TeardownResult } from './teardown'
import { measured, type BenchmarkRecorder } from './timing'

const BENCHMARK_ENVIRONMENT = { ATLAS_TELEMETRY_DISABLED: '1' }

export type BenchmarkCloud = {
  config: VercelSandboxConfig
  bridge: CloudBridge
  driver: VercelDriver
  attachment: () => CloudAttachment | undefined
  cleanup: (args: { name: string; threadId: ThreadId }) => Promise<TeardownResult>
  runtime: (name: string) => Promise<BakedRuntime>
}

const driveListed = async (args: {
  config: VercelSandboxConfig
  name: string
}): Promise<boolean> => {
  const listed = await liveDriveSdk.list({
    ...args.config.credentials,
    namePrefix: args.name,
    sortBy: 'name',
    signal: AbortSignal.timeout(30_000),
  })
  for await (const drive of listed) if (drive.name === args.name) return true
  return false
}

export const benchmarkBridge = (args: {
  app: AtlasApp
  image?: string | undefined
  record: BenchmarkRecorder
}): BenchmarkCloud => {
  const { app, record } = args
  const options = liveBridgeOptionsFor(app)
  const resolved = options.vercel()
  const config: VercelSandboxConfig =
    args.image === undefined
      ? resolved
      : { ...resolved, image: args.image, serveVersion: undefined }
  const driver = new BenchmarkDriver({
    ...config,
    record,
    cloudUrl: options.cloudUrl?.() ?? '',
    onDriverLog: options.onDriverLog,
  })
  const capture = options.capturePortable
  const live = createLocalCloudBridge({
    ...options,
    ...(args.image === undefined ? {} : { vercel: () => config }),
    driverWith: () => driver,
    ...(capture === undefined
      ? {}
      : { capturePortable: () => measured({ name: 'capture-portable', record, run: capture }) }),
    environment: () => ({ ...options.environment?.(), ...BENCHMARK_ENVIRONMENT }),
  })

  let attachment: CloudAttachment | undefined
  let teardown: Promise<void> | undefined
  const destroy = (params: { threadId: ThreadId }): Promise<void> => {
    teardown = measured({
      name: 'sandbox-and-drive-delete',
      record,
      run: () => live.sandboxes.destroy(params),
    })
    return teardown
  }

  return {
    config,
    driver,
    attachment: () => attachment,
    runtime: async (name) => {
      const sandbox = await liveSdk.get({
        ...config.credentials,
        name,
        resume: false,
        signal: AbortSignal.timeout(30_000),
      })
      const command = await sandbox.runCommand({
        cmd: 'sh',
        args: [
          '-c',
          `printf 'version=%s\\nprotocol=%s\\nbakeId=%s\\n' "$(cat /opt/atlas/atlas-serve.version)" "$(cat /opt/atlas/atlas-serve.protocol)" "$(cat /opt/atlas/atlas-serve.bake-id)"`,
        ],
        timeoutMs: 15_000,
      })
      if (command.exitCode !== 0) throw new Error('could not read baked sandbox runtime identity')
      return parseBakedRuntime(await command.stdout())
    },
    cleanup: async ({ name, threadId }) => {
      if (name !== sandboxNameFor({ threadId })) {
        throw new Error('cleanup name does not belong to the thread being cleaned')
      }
      return measured({
        name: 'verified-teardown',
        record,
        run: () =>
          teardownUntilAbsent({
            pending: teardown,
            destroy: () => destroy({ threadId }),
            sandboxPresent: async () => (await driver.inspect({ name })) !== undefined,
            drivePresent: () => driveListed({ config, name: driveNameFor({ threadId }) }),
          }),
      })
    },
    bridge: {
      ...live,
      sandboxes: {
        ...live.sandboxes,
        create: (params) =>
          measured({
            name: 'bridge-create',
            record,
            run: () => live.sandboxes.create(params),
          }),
        destroy,
      },
      attach: (params) => {
        attachment = live.attach(params)
        return attachment
      },
    },
  }
}
