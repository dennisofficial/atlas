import { lstat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { captureContextArchive, loadSettings, sandboxNameFor } from '@dltech/atlas-harness'
import { noticePortBinding } from '../../src/composition/notice-binding'
import { cloneBenchmarkSession } from './fixture'
import { benchmarkBridge, type BenchmarkCloud } from './bridge'
import {
  assertBenchmarkOutput,
  checkedGit,
  prepareBenchmarkWorkspace,
  seedBenchmarkHome,
} from './environment'
import { mountCloudBenchmark } from './mount'
import { fileRecorder, measured, type BenchmarkRecorder } from './timing'
import {
  captureIdentities,
  sessionFileDigest,
  verifyLocalIdentities,
  verifyRemoteIdentities,
  workspaceSentinels,
} from './verify'
import type { BakedRuntime } from './runtime'

export type SampleArgs = {
  sourceHome: string
  sourceSession: string
  sourceRepository: string
  directory: string
  image?: string | undefined
}

const WORKTREE_REMOVE_ATTEMPTS = 5
const WORKTREE_REMOVE_DELAY_MS = 500

const requireRemovedWorktree = async (cwd: string): Promise<void> => {
  for (let attempt = 1; attempt <= WORKTREE_REMOVE_ATTEMPTS; attempt += 1) {
    try {
      await lstat(cwd)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    if (attempt < WORKTREE_REMOVE_ATTEMPTS) await Bun.sleep(WORKTREE_REMOVE_DELAY_MS)
  }
  throw new Error('the lifted disposable worktree was not removed')
}

const optionalDiagnostic = async <T>(args: {
  name: string
  record: BenchmarkRecorder
  run: () => Promise<T>
}): Promise<T | undefined> => {
  try {
    return await args.run()
  } catch (error) {
    args.record({
      phase: 'diagnostic-failed',
      name: args.name,
      message: error instanceof Error ? error.message : 'unknown diagnostic failure',
    })
    return undefined
  }
}

export const runSample = async (args: SampleArgs): Promise<void> => {
  if (!/^brn_[\w-]+$/.test(args.sourceSession))
    throw new Error('benchmark source must be a session ID')
  const original = join(args.sourceHome, 'sessions', args.sourceSession)
  await assertBenchmarkOutput({
    output: args.directory,
    protectedRoots: [original, args.sourceRepository],
  })
  const record = fileRecorder(join(args.directory, 'timeline.jsonl'))
  const sourceDigest = await sessionFileDigest(original)
  const home = await seedBenchmarkHome({ sourceHome: args.sourceHome, directory: args.directory })
  const workspace = await prepareBenchmarkWorkspace({
    sourceRepository: args.sourceRepository,
    directory: args.directory,
  })
  const clone = await cloneBenchmarkSession({
    sourceSession: original,
    destinationHome: home,
    workspace: workspace.cwd,
  })
  record({
    phase: 'fixture',
    sourceSession: args.sourceSession,
    threadId: clone.threadId,
    sourceBytes: clone.sourceBytes,
    copiedBytes: clone.copiedBytes,
    files: clone.files,
    events: clone.events,
    threads: clone.threadIds.length,
    workspaceCommit: workspace.commit,
  })
  process.env.ATLAS_HOME = home
  process.env.ATLAS_TELEMETRY_DISABLED = '1'
  const settings = loadSettings({ env: process.env, cwd: workspace.cwd })
  const name = sandboxNameFor({ threadId: clone.threadId })
  const holder: { cloud?: BenchmarkCloud } = {}
  let mounted: Awaited<ReturnType<typeof mountCloudBenchmark>> | undefined
  let lifted = false
  let descended = false
  let completed = false
  try {
    mounted = await mountCloudBenchmark({
      cwd: workspace.cwd,
      threadId: clone.threadId,
      threadIds: clone.threadIds,
      settings,
      record,
      bridgeFor: (app) => {
        holder.cloud = benchmarkBridge({ app, image: args.image, record })
        return holder.cloud.bridge
      },
      captureContext: () =>
        measured({
          name: 'capture-context',
          record,
          run: () =>
            captureContextArchive({
              atlasHome: args.sourceHome,
              home: homedir(),
              cwd: args.sourceRepository,
              notice: noticePortBinding(),
            }),
        }),
    })
    const active = mounted
    const cloud = holder.cloud
    if (cloud === undefined)
      throw new Error('benchmark mount did not construct its production bridge')
    record({
      phase: 'runtime-config',
      image: cloud.config.image,
      serveVersion: cloud.config.serveVersion ?? null,
    })
    if ((await cloud.driver.inspect({ name })) !== undefined)
      throw new Error('benchmark requires a fresh sandbox name')
    const expected = await captureIdentities({
      log: active.app.log,
      ledger: active.app.ledger,
      threadIds: clone.threadIds,
    })
    const sentinels = await workspaceSentinels(workspace.cwd)
    const lift = await active.command('/container cloud')
    lifted = true
    const attachment = cloud.attachment()
    if (attachment === undefined) throw new Error('literal lift did not attach a cloud channel')
    await requireRemovedWorktree(workspace.cwd)
    await measured({
      name: 'verify-cloud-history-and-idle',
      record,
      run: () => verifyRemoteIdentities({ attachment, expected }),
    })
    await optionalDiagnostic({
      name: 'cloud-frame',
      record,
      run: async () =>
        writeFile(join(args.directory, 'cloud-frame.txt'), await active.frame(), {
          flag: 'wx',
          mode: 0o600,
        }),
    })
    await optionalDiagnostic({
      name: 'serve-log',
      record,
      run: async () =>
        writeFile(join(args.directory, 'serve.log'), await cloud.driver.serveLogTail({ name }), {
          flag: 'wx',
          mode: 0o600,
        }),
    })
    const runtime = await optionalDiagnostic({
      name: 'runtime-identity',
      record,
      run: () => cloud.runtime(name),
    })
    if (runtime !== undefined) record({ phase: 'baked-runtime', ...runtime })
    const descend = await active.command('/container host')
    descended = true
    await measured({
      name: 'verify-descended-history-and-idle',
      record,
      run: () =>
        verifyLocalIdentities({ log: active.app.log, ledger: active.app.ledger, expected }),
    })
    const restored = active.app.sessionOwner.snapshot().binding?.cwd ?? workspace.cwd
    if ((await workspaceSentinels(restored)) !== sentinels)
      throw new Error('round trip changed staged/unstaged/untracked sentinels')
    await checkedGit({ cwd: restored, argv: ['fsck', '--no-dangling'] })
    const teardown = await cloud.cleanup({ name, threadId: clone.threadId })
    if ((await sessionFileDigest(original)) !== sourceDigest)
      throw new Error('original session changed during benchmark')
    record({
      phase: 'verification',
      cloudHistory: true,
      descendedHistory: true,
      idleSuffixesAndLedger: true,
      workspaceSentinels: true,
      gitFsck: true,
      originalSessionUnchanged: true,
      sandboxDeleted: teardown.sandboxAbsent,
      driveDeleted: teardown.driveAbsent,
    })
    if (runtime === undefined)
      throw new Error(
        'round trip verified and resources deleted, but runtime identity is unknown; not a controlled timing sample',
      )
    const result = {
      ok: true,
      liftMs: lift.elapsedMs,
      descendMs: descend.elapsedMs,
      liftSteps: lift.timings,
      descendSteps: descend.timings,
      fixture: {
        sourceBytes: clone.sourceBytes,
        events: clone.events,
        threads: clone.threadIds.length,
      },
      image: cloud.config.image,
      runtime,
      workspaceCommit: workspace.commit,
      directory: args.directory,
    }
    await writeFile(join(args.directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    completed = true
  } catch (error) {
    record({
      phase: 'failure',
      message: error instanceof Error ? error.message : String(error),
      sandboxName: name,
      directory: args.directory,
    })
    const cloud = holder.cloud
    if (cloud !== undefined)
      await optionalDiagnostic({
        name: 'failure-serve-log',
        record,
        run: async () =>
          writeFile(
            join(args.directory, 'failure-serve.log'),
            await cloud.driver.serveLogTail({ name }),
            { flag: 'wx', mode: 0o600 },
          ),
      })
    throw error
  } finally {
    if (lifted && !descended && mounted !== undefined) {
      const active = mounted
      const restored = await optionalDiagnostic({
        name: 'failure-descend',
        record,
        run: () => active.command('/container host'),
      })
      if (restored !== undefined) {
        descended = true
        const cloud = holder.cloud
        if (cloud !== undefined)
          await optionalDiagnostic({
            name: 'failure-teardown',
            record,
            run: () => cloud.cleanup({ name, threadId: clone.threadId }),
          })
      }
    }
    holder.cloud?.attachment()?.channel.close()
    await mounted?.close()
    settings.service.close()
    const inspectHandles: unknown = Reflect.get(process, '_getActiveHandles')
    if (typeof inspectHandles === 'function') {
      const handles: unknown = Reflect.apply(inspectHandles, process, [])
      if (Array.isArray(handles)) record({ phase: 'post-cleanup-handles', count: handles.length })
    }
    record({
      phase: completed
        ? 'sample-completed'
        : descended
          ? 'failed-sample-descended'
          : 'sample-retained-for-recovery',
      sandboxName: name,
    })
  }
}
