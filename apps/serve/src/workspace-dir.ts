import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'
import { repoNameOfRemoteUrl } from '@dltech/atlas-core'
import { SANDBOX_WORKSPACES_PATH, SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'

import type { FetchWorkspaceSpec } from './workspace-spec'

const WORKSPACE_DIR_FILE = join('operational', 'workspace-dir.json')

const workspaceDirRecordSchema = z.object({ workspaceDir: z.string().min(1) })

export const workspaceDirRecordFile = (args: { atlasHome: string }): string =>
  join(args.atlasHome, WORKSPACE_DIR_FILE)

/**
 * The directory serve boots its workspace in. A recorded answer always wins: the bootstrap spec is
 * written on a fresh boot only, so a resumed sandbox must recover the same dir from its own
 * filesystem rather than re-deriving it from a spec that may no longer match. A corrupt record is
 * ignored — the spec decides again, and the write below replaces the record.
 */
export async function readRecordedWorkspaceDir(args: {
  atlasHome: string
}): Promise<string | null> {
  let text: string
  try {
    text = await readFile(workspaceDirRecordFile(args), 'utf8')
  } catch {
    return null
  }
  try {
    return workspaceDirRecordSchema.parse(JSON.parse(text)).workspaceDir
  } catch {
    return null
  }
}

export async function writeRecordedWorkspaceDir(args: {
  atlasHome: string
  workspaceDir: string
}): Promise<void> {
  const file = workspaceDirRecordFile(args)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ workspaceDir: args.workspaceDir }), 'utf8')
}

/**
 * The workspace dir for this boot: the record when one exists, otherwise the repo name derived
 * from the spec's remote, otherwise the launcher's own cwd (`/atlas/workspaces/workspace`) — the
 * no-remote fallback that keeps the path contract's placeholder shape for threads with no repo.
 */
export async function resolveWorkspaceDir(args: {
  atlasHome: string
  fetchSpec: FetchWorkspaceSpec
}): Promise<string> {
  const recorded = await readRecordedWorkspaceDir({ atlasHome: args.atlasHome })
  if (recorded !== null) return recorded
  try {
    const spec = await args.fetchSpec()
    if (spec.remoteUrl !== null) {
      return `${SANDBOX_WORKSPACES_PATH}/${repoNameOfRemoteUrl(spec.remoteUrl)}`
    }
  } catch {
    // a missing or unreadable spec still boots: the fallback keeps serve alive to report it
  }
  return SANDBOX_WORKSPACE_PATH
}
