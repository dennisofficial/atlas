import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'
import { repoNameOfRemoteUrl } from '@dltech/atlas-core'
import { SANDBOX_WORKSPACES_PATH, SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'

import { messageOf } from './context-readiness'
import type { FetchWorkspaceSpec, WorkspaceSpec } from './workspace-spec'

const WORKSPACE_DIR_FILE = join('operational', 'workspace-dir.json')
const DEFAULT_ATTEMPTS = 3
const BACKOFF_MS = 250

const workspaceDirRecordSchema = z.object({ workspaceDir: z.string().min(1) })

export const workspaceDirRecordFile = (args: { atlasHome: string }): string =>
  join(args.atlasHome, WORKSPACE_DIR_FILE)

/**
 * The dir an earlier boot recorded, or null when there is none. A corrupt record is ignored, so the
 * spec decides again and the next non-failed boot's write replaces it.
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

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const repoDirOf = (remoteUrl: string): string =>
  `${SANDBOX_WORKSPACES_PATH}/${repoNameOfRemoteUrl(remoteUrl)}`

const isRepoDir = (workspaceDir: string): boolean => workspaceDir !== SANDBOX_WORKSPACE_PATH

const fetchSpecWithRetry = async (args: {
  fetchSpec: FetchWorkspaceSpec
  attempts: number
  sleep: (ms: number) => Promise<void>
}): Promise<WorkspaceSpec> => {
  let lastError: unknown = new Error('the workspace spec never arrived')
  for (let attempt = 1; attempt <= args.attempts; attempt += 1) {
    try {
      return await args.fetchSpec()
    } catch (error) {
      lastError = error
      if (attempt < args.attempts) await args.sleep(BACKOFF_MS * attempt)
    }
  }
  throw new Error(
    `the workspace spec never arrived after ${args.attempts} attempts: ${messageOf(lastError)}`,
  )
}

/**
 * The workspace dir for this boot: the repo the spec's remote names, else the recorded dir, else
 * the launcher placeholder that threads with no repo use.
 */
export async function resolveWorkspaceDir(args: {
  atlasHome: string
  fetchSpec: FetchWorkspaceSpec
  attempts?: number | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
}): Promise<string> {
  const recorded = await readRecordedWorkspaceDir({ atlasHome: args.atlasHome })
  const attempts = args.attempts ?? DEFAULT_ATTEMPTS
  let spec: WorkspaceSpec
  try {
    spec = await fetchSpecWithRetry({
      fetchSpec: args.fetchSpec,
      attempts,
      sleep: args.sleep ?? defaultSleep,
    })
  } catch (error) {
    if (recorded !== null && isRepoDir(recorded)) return recorded
    throw error
  }
  if (spec.remoteUrl !== null) return repoDirOf(spec.remoteUrl)
  return recorded ?? SANDBOX_WORKSPACE_PATH
}
