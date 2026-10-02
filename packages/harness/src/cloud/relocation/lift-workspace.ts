import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../../workspace/transfer/capture'
import type { WorkspaceManifest } from '../../workspace/transfer/manifest'

export type LiftWorkspaceArchive = {
  path: string
  manifest: WorkspaceManifest
  release: () => Promise<void>
}

export type LiftWorkspaceCapture = (args: { cwd: string }) => Promise<LiftWorkspaceArchive | undefined>

export const captureLiftWorkspace: LiftWorkspaceCapture = async ({ cwd }) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-lift-workspace-'))
  const path = join(directory, 'workspace.tar.gz')
  try {
    const manifest = await captureWorkspaceArchive({ cwd, destination: path })
    return { path, manifest, release: () => rm(directory, { recursive: true, force: true }) }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
