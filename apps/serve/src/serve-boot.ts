import { existsSync } from 'node:fs'

import {
  EExecutionLocation,
  EHarnessPlacement,
  ERunner,
  normalizeRepoOrigin,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  POD_NAME_ENV,
  metaWithPlacement,
  newThreadMeta,
  readMetaSync,
  registryFor,
  sessionDirectory,
  writeMeta,
  writeSessionMetaForRoot,
  threadMetaFile,
  threadMetaSchema,
} from '@dltech/atlas-harness'

import {
  createEnvironmentProfile,
  EProfileStepState,
  type ApplyEnvironmentProfile,
} from './environment-profile'
import { applyCloudState } from './cloud-state'
import { applyGitAccessEnv } from './git-access-env'
import {
  createEnsureWorkspace,
  EWorkspaceState,
  type EnsureWorkspace,
  type WorkspaceReadiness,
} from './materialize-workspace'
import { projectWorkspaceSpecFetcher } from './project-workspace-spec'
import { applyPublishedBundle } from './published-bundle'
import { applySigningKey } from './signing-key-env'
import { EServeEvent, type ServeLog } from './serve-log'
import { resolveWorkspaceDir, writeRecordedWorkspaceDir } from './workspace-dir'
import type { WorkspaceFiles } from './workspace-files'

const lazy = <T>(fetch: () => Promise<T>): (() => Promise<T>) => {
  let held: Promise<T> | undefined
  return () => (held ??= fetch())
}

export async function bootServeFiles(args: {
  env: Record<string, string | undefined>
  threadId: ThreadId
  cwd: string
  atlasHome: string
  log: ServeLog
  ensureWorkspace?: EnsureWorkspace | undefined
  profile?: ApplyEnvironmentProfile | undefined
  contextFiles?: WorkspaceFiles | undefined
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}) {
  const { env, threadId, atlasHome, log } = args
  const fetchSpecOnce = lazy(
    projectWorkspaceSpecFetcher({
      atlasHome,
      controlPlaneUrl: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
    }),
  )

  const workspaceStartedAt = Date.now()
  const cwd = await resolveWorkspaceDir({ atlasHome, fetchSpec: fetchSpecOnce })
  const profile = args.profile ?? createEnvironmentProfile({ env })
  const ensureWorkspace = args.ensureWorkspace ?? createEnsureWorkspace({ profile })
  const workspace: WorkspaceReadiness = await ensureWorkspace({ cwd, fetchSpec: fetchSpecOnce })
  const workspaceMs = Date.now() - workspaceStartedAt

  if (workspace.state !== EWorkspaceState.Failed) {
    if (cwd !== process.cwd() && existsSync(cwd)) process.chdir(cwd)
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: cwd }).catch(() => undefined)
  }

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
  await applySigningKey({
    env,
    atlasHome,
    log,
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })
  await applyCloudState({
    atlasHome,
    log,
    env,
    projectId: spec?.projectId ?? null,
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })

  const identity = spec === null || spec.remoteUrl === null ? null : normalizeRepoOrigin(spec.remoteUrl)
  await applyPublishedBundle({
    atlasHome,
    projectDirectory: cwd,
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
    log,
    files: args.contextFiles,
  })

  const sessionDir = sessionDirectory({ home: atlasHome, sessionId: threadId })
  const metaFile = threadMetaFile({ sessionDir, threadId })
  if (readMetaSync({ file: metaFile, schema: threadMetaSchema }) === undefined) {
    const born = newThreadMeta({ id: threadId, at: new Date().toISOString() })
    born.workspace = cwd
    born.projectId = spec?.projectId ?? null
    if (env[POD_NAME_ENV]) born.runner = ERunner.Local
    const meta = metaWithPlacement({
      meta: born,
      record: { placement: { harness: EHarnessPlacement.Cloud }, revision: 0 },
    })
    await writeMeta({ file: metaFile, meta })
    await writeSessionMetaForRoot({
      registry: registryFor({ home: atlasHome }),
      sessionDir,
      root: meta,
      home: EExecutionLocation.Cloud,
    })
  }

  return { workspace, activeCwd: cwd, spec, identity }
}
