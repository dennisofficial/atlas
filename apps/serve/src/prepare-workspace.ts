import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { projectDirectoryOf, type EventLogPort, type ThreadId } from '@dltech/atlas-core'
import {
  captureWorkspaceArchive,
  exportCwdOf,
  requireCoveredSourceWorktrees,
  type RestoredWorkspace,
  type SourceCoverageChecker,
} from '@dltech/atlas-harness'
import {
  workspaceManifestWireSchema,
  type PrepareWorkspaceArchiveReply,
} from '@dltech/atlas-wire'

import { driveWorkspaceExportDirectory } from './drive-bootstrap'

export type WorkspaceCapturer = typeof captureWorkspaceArchive

const EXPORT_PREFIX = 'workspace-'

export async function prepareWorkspaceExport(args: {
  driveHome: string
  threadId: ThreadId
  launchDirectory: string
  primaryWorkspace?: RestoredWorkspace | undefined
  log: Pick<EventLogPort, 'readOwn'>
  capture?: WorkspaceCapturer | undefined
  requireCoverage?: SourceCoverageChecker | undefined
  stopProcesses?: (() => Promise<void>) | undefined
}): Promise<PrepareWorkspaceArchiveReply> {
  const capture = args.capture ?? captureWorkspaceArchive
  const requireCoverage = args.requireCoverage ?? requireCoveredSourceWorktrees
  const events = await args.log.readOwn({ threadId: args.threadId })
  const cwd = await exportCwdOf({
    cwd: projectDirectoryOf({ events, launchDirectory: args.launchDirectory }),
    primary: args.primaryWorkspace,
  })

  await requireCoverage({ cwd })

  const directory = driveWorkspaceExportDirectory(args)
  await mkdir(directory, { recursive: true })
  for (const name of await readdir(directory)) {
    if (name.startsWith(EXPORT_PREFIX)) await rm(join(directory, name), { force: true })
  }

  await args.stopProcesses?.()

  const path = join(directory, `${EXPORT_PREFIX}${randomBytes(8).toString('hex')}.tar.gz`)
  const staging = `${path}.partial`
  try {
    const manifest = await capture({ cwd, destination: staging })
    await requireCoverage({ cwd, manifest })
    await rename(staging, path)
    return { path, manifest: workspaceManifestWireSchema.parse(manifest) }
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}
