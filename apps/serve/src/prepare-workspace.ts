import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { projectDirectoryOf, type EventLogPort, type ThreadId } from '@dltech/atlas-core'
import {
  type ArchiveBuildReporter,
  captureWorkspaceArchive,
  captureWorkspaceFamily,
  captureSourceCleanupProof,
  exportCwdOf,
  requireCoveredSourceWorktrees,
  type RestoredWorkspace,
  type SourceCoverageChecker,
  type SourceCleanupProof,
  type ThreadStorePort,
} from '@dltech/atlas-harness'
import {
  workspaceManifestWireSchema,
  type PrepareWorkspaceArchiveReply,
} from '@dltech/atlas-wire'

import { driveWorkspaceExportDirectory } from './drive-bootstrap'
import { sha256OfFile } from './direct-workspace'

export type WorkspaceCapturer = typeof captureWorkspaceArchive

const EXPORT_PREFIX = 'workspace-'

export async function prepareWorkspaceExport(args: {
  driveHome: string
  threadId: ThreadId
  launchDirectory: string
  primaryWorkspace?: RestoredWorkspace | undefined
  log: Pick<EventLogPort, 'readOwn'>
  threads?: Pick<ThreadStorePort, 'find' | 'spawned'> | undefined
  sourceSessionId?: string | undefined
  onCleanupProof?: ((proof: SourceCleanupProof) => void) | undefined
  capture?: WorkspaceCapturer | undefined
  requireCoverage?: SourceCoverageChecker | undefined
  stopProcesses?: (() => Promise<void>) | undefined
  onBuildProgress?: ArchiveBuildReporter | undefined
}): Promise<PrepareWorkspaceArchiveReply> {
  const capture = args.capture ?? captureWorkspaceArchive
  const requireCoverage = args.requireCoverage ?? requireCoveredSourceWorktrees
  const events = await args.log.readOwn({ threadId: args.threadId })
  const cwd = await exportCwdOf({
    cwd: projectDirectoryOf({ events, launchDirectory: args.launchDirectory }),
    primary: args.primaryWorkspace,
  })

  if (args.threads === undefined) await requireCoverage({ cwd })
  await args.stopProcesses?.()
  const family = args.threads === undefined ? undefined : await captureWorkspaceFamily({
    threadId: args.threadId, cwd, threads: args.threads, log: args.log,
    sessionDir: join(args.driveHome, 'sessions', args.threadId),
  })
  if (family === undefined && args.threads !== undefined) await requireCoverage({ cwd })

  const directory = driveWorkspaceExportDirectory(args)
  await mkdir(directory, { recursive: true })
  for (const name of await readdir(directory)) {
    if (name.startsWith(EXPORT_PREFIX)) await rm(join(directory, name), { force: true })
  }

  const path = join(directory, `${EXPORT_PREFIX}${randomBytes(8).toString('hex')}.tar.gz`)
  const staging = `${path}.partial`
  try {
    const manifest = await capture({ cwd, destination: staging, family, onBuildProgress: args.onBuildProgress })
    if (family === undefined) await requireCoverage({ cwd, manifest })
    const proof = family === undefined ? undefined : await captureSourceCleanupProof({ cwd, manifest, generation: path, sourceSessionId: args.sourceSessionId ?? '' })
    if (proof !== undefined && proof.sessionId.length === 0) proof.retentionReasons.push('the source runtime has no provider-session identity')
    if (proof !== undefined) args.onCleanupProof?.(proof)
    await rename(staging, path)
    const { size: totalBytes } = await stat(path)
    return {
      path, manifest: workspaceManifestWireSchema.parse(manifest), totalBytes,
      sha256: await sha256OfFile(path),
      ...(proof === undefined ? {} : { cleanup: { generation: proof.generation, sourceSessionId: proof.sessionId, safe: proof.retentionReasons.length === 0, reasons: proof.retentionReasons } }),
    }
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}
