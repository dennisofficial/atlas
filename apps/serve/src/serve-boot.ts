import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  newThreadMeta,
  registryFor,
  sessionDirectory,
  writeMeta,
  writeSessionMetaForRoot,
  threadMetaFile,
} from '@dltech/atlas-harness'

import {
  driveContextArchiveFetcher,
  driveTranscriptArchiveFetcher,
  driveWorkspaceSpecFetcher,
} from './drive-bootstrap'
import { createDirectWorkspace, type DirectWorkspaceRestorer } from './direct-workspace'
import { applyDirectProfile } from './direct-profile'
import {
  createEnvironmentProfile,
  EProfileStepState,
  type ApplyEnvironmentProfile,
} from './environment-profile'
import { applyGitAccessEnv } from './git-access-env'
import {
  createEnsureWorkspace,
  EWorkspaceState,
  EWorkspaceStep,
  type EnsureWorkspace,
  type WorkspaceReadiness,
} from './materialize-workspace'
import { materializeContext } from './materialize-context'
import { materializeTranscript } from './materialize-transcript'
import { EServeEvent, type ServeLog } from './serve-log'
import type { WorkspaceFiles } from './workspace-files'
import type { FetchTranscriptArchive } from './workspace-spec'

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
  restoreWorkspace?: DirectWorkspaceRestorer | undefined
  profile?: ApplyEnvironmentProfile | undefined
  contextFiles?: WorkspaceFiles | undefined
  fetchTranscriptArchive?: FetchTranscriptArchive | undefined
}) {
  const { env, threadId, cwd, driveHome, log } = args
  const fetchSpecOnce = lazy(driveWorkspaceSpecFetcher({ driveHome }))

  const workspaceStartedAt = Date.now()
  const profile = args.profile ?? createEnvironmentProfile({ env })
  const ensureWorkspace = args.ensureWorkspace ?? createEnsureWorkspace({ profile })
  const direct = createDirectWorkspace({ driveHome, destination: cwd, restore: args.restoreWorkspace })
  const directBoot = await direct.boot()
  const workspace: WorkspaceReadiness =
    directBoot.kind === 'ready'
      ? {
          state: EWorkspaceState.Present,
          profile: await applyDirectProfile({
            env,
            cwd: directBoot.result.restored.cwd,
            fetchSpec: fetchSpecOnce,
            profile,
          }),
        }
      : directBoot.kind === 'failed'
        ? { state: EWorkspaceState.Failed, step: EWorkspaceStep.Apply, reason: directBoot.reason }
        : await ensureWorkspace({ cwd, fetchSpec: fetchSpecOnce })
  const activeCwd = directBoot.kind === 'ready' ? directBoot.result.restored.cwd : cwd
  const workspaceMs = Date.now() - workspaceStartedAt

  if (workspace.state === EWorkspaceState.Failed) {
    log({
      event: EServeEvent.WorkspaceFailed,
      step: workspace.step,
      reason: workspace.reason,
      ms: workspaceMs,
    })
  } else {
    log({ event: EServeEvent.WorkspaceReady, state: workspace.state, cwd: activeCwd, ms: workspaceMs })
    for (const outcome of workspace.profile?.steps ?? []) {
      if (outcome.state !== EProfileStepState.Failed) continue
      log({ event: EServeEvent.ProfileStepFailed, step: outcome.step, detail: outcome.detail })
    }
  }

  const spec = await fetchSpecOnce().catch(() => null)
  applyGitAccessEnv({ env, cwd: activeCwd, githubToken: spec?.githubToken })

  const contextStartedAt = Date.now()
  const context = await materializeContext({
    fetchSpec: fetchSpecOnce,
    fetchArchive: driveContextArchiveFetcher({ driveHome }),
    atlasHome: driveHome,
    cwd: activeCwd,
    files: args.contextFiles,
  })
  const contextMs = Date.now() - contextStartedAt
  if (context.failed !== null) {
    log({ event: EServeEvent.ContextFailed, reason: context.failed, ms: contextMs })
  } else if (context.written > 0) {
    log({ event: EServeEvent.ContextReady, written: context.written, ms: contextMs })
  }

  const transcriptStartedAt = Date.now()
  const transcript = await materializeTranscript({
    fetchArchive: args.fetchTranscriptArchive ?? driveTranscriptArchiveFetcher({ driveHome }),
    atlasHome: driveHome,
    threadId,
  })
  const transcriptMs = Date.now() - transcriptStartedAt
  if (transcript.failed !== null) {
    log({ event: EServeEvent.TranscriptFailed, reason: transcript.failed, ms: transcriptMs })
    throw new Error(`the transcript could not be restored at boot: ${transcript.failed}`)
  }
  if (transcript.restored) log({ event: EServeEvent.TranscriptRestored, ms: transcriptMs })
  if (transcript.fresh) {
    const sessionDir = sessionDirectory({ home: driveHome, sessionId: threadId })
    const meta = newThreadMeta({ id: threadId, at: new Date().toISOString() })
    meta.workspace = activeCwd
    await writeMeta({ file: threadMetaFile({ sessionDir, threadId }), meta })
    await writeSessionMetaForRoot({
      registry: registryFor({ home: driveHome }),
      sessionDir,
      root: meta,
      home: EExecutionLocation.Cloud,
    })
  }

  return {
    direct,
    directBoot,
    workspace,
    activeCwd,
    bootDormant: directBoot.kind === 'ready' && !directBoot.result.activated,
    spec,
    context,
  }
}
