import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  newThreadMeta,
  readMetaSync,
  registryFor,
  sessionDirectory,
  writeMeta,
  writeSessionMetaForRoot,
  threadMetaFile,
  threadMetaSchema,
} from '@dltech/atlas-harness'

import { driveContextArchiveFetcher, driveWorkspaceSpecFetcher } from './drive-bootstrap'
import {
  createEnvironmentProfile,
  EProfileStepState,
  type ApplyEnvironmentProfile,
} from './environment-profile'
import { applyGitAccessEnv } from './git-access-env'
import {
  createEnsureWorkspace,
  EWorkspaceState,
  type EnsureWorkspace,
  type WorkspaceReadiness,
} from './materialize-workspace'
import { materializeContext } from './materialize-context'
import { EServeEvent, type ServeLog } from './serve-log'
import type { WorkspaceFiles } from './workspace-files'

const lazy = <T>(fetch: () => Promise<T>): (() => Promise<T>) => {
  let held: Promise<T> | undefined
  return () => (held ??= fetch())
}

export async function bootServeFiles(args: {
  env: Record<string, string | undefined>
  threadId: ThreadId
  cwd: string
  driveHome: string
  log: ServeLog
  ensureWorkspace?: EnsureWorkspace | undefined
  profile?: ApplyEnvironmentProfile | undefined
  contextFiles?: WorkspaceFiles | undefined
}) {
  const { env, threadId, cwd, driveHome, log } = args
  const fetchSpecOnce = lazy(driveWorkspaceSpecFetcher({ driveHome }))

  const workspaceStartedAt = Date.now()
  const profile = args.profile ?? createEnvironmentProfile({ env })
  const ensureWorkspace = args.ensureWorkspace ?? createEnsureWorkspace({ profile })
  const workspace: WorkspaceReadiness = await ensureWorkspace({ cwd, fetchSpec: fetchSpecOnce })
  const workspaceMs = Date.now() - workspaceStartedAt

  if (workspace.state === EWorkspaceState.Failed) {
    log({
      event: EServeEvent.WorkspaceFailed,
      step: workspace.step,
      reason: workspace.reason,
      ms: workspaceMs,
    })
  } else {
    log({ event: EServeEvent.WorkspaceReady, state: workspace.state, cwd, ms: workspaceMs })
    for (const outcome of workspace.profile?.steps ?? []) {
      if (outcome.state !== EProfileStepState.Failed) continue
      log({ event: EServeEvent.ProfileStepFailed, step: outcome.step, detail: outcome.detail })
    }
  }

  const spec = await fetchSpecOnce().catch(() => null)
  applyGitAccessEnv({ env, cwd, githubToken: spec?.githubToken })

  const contextStartedAt = Date.now()
  const context = await materializeContext({
    fetchSpec: fetchSpecOnce,
    fetchArchive: driveContextArchiveFetcher({ driveHome }),
    atlasHome: driveHome,
    files: args.contextFiles,
  })
  const contextMs = Date.now() - contextStartedAt
  if (context.failed !== null) {
    log({ event: EServeEvent.ContextFailed, reason: context.failed, ms: contextMs })
  } else if (context.written > 0) {
    log({ event: EServeEvent.ContextReady, written: context.written, ms: contextMs })
  }

  const sessionDir = sessionDirectory({ home: driveHome, sessionId: threadId })
  const metaFile = threadMetaFile({ sessionDir, threadId })
  if (readMetaSync({ file: metaFile, schema: threadMetaSchema }) === undefined) {
    const meta = newThreadMeta({ id: threadId, at: new Date().toISOString() })
    meta.workspace = cwd
    await writeMeta({ file: metaFile, meta })
    await writeSessionMetaForRoot({
      registry: registryFor({ home: driveHome }),
      sessionDir,
      root: meta,
      home: EExecutionLocation.Cloud,
    })
  }

  return { workspace, activeCwd: cwd, spec, context }
}
