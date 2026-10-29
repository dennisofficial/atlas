import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

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
import { EBootStep, NOOP_BOOT_REPORTER, type BootReporter } from '@dltech/atlas-wire'

import {
  createEnvironmentProfile,
  EProfileStepState,
  type ApplyEnvironmentProfile,
} from './environment-profile'
import { applyCloudInstructions } from './cloud-instructions'
import { createCloudStateRefresh } from './cloud-state-refresh'
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
import { trackClone } from './serve-boot-reporter'
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
  reporter?: BootReporter | undefined
}) {
  const { env, threadId, atlasHome, log } = args
  const reporter = args.reporter ?? NOOP_BOOT_REPORTER
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
  const workspace: WorkspaceReadiness = await trackClone({
    reporter,
    work: () => ensureWorkspace({ cwd, fetchSpec: fetchSpecOnce }),
  })
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
  if (spec?.projectId && !spec.githubToken) {
    log({ event: EServeEvent.GithubTokenAbsent, projectId: spec.projectId })
  }
  await applySigningKey({
    env,
    atlasHome,
    log,
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })
  const refreshCloudState = createCloudStateRefresh({
    atlasHome,
    log,
    env,
    projectId: spec?.projectId ?? null,
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
    fileMountRoots: {
      repositoryDir:
        workspace.state === EWorkspaceState.Failed || workspace.state === EWorkspaceState.Skipped
          ? null
          : cwd,
      homeDir: env.HOME ?? homedir(),
    },
  })
  const fileMounts = await reporter.track({
    step: EBootStep.Settings,
    work: () => refreshCloudState.boot(),
  })

  const identity =
    spec === null || spec.remoteUrl === null ? null : normalizeRepoOrigin(spec.remoteUrl)
  await reporter.track({
    step: EBootStep.Context,
    work: async () => {
      const remote = {
        atlasHome,
        controlPlaneUrl: args.controlPlaneUrl,
        token: args.token,
        clientVersion: args.clientVersion,
        fetchFn: args.fetchFn,
        log,
        files: args.contextFiles,
      }
      await applyPublishedBundle({ ...remote, projectDirectory: cwd })
      await applyCloudInstructions(remote)
    },
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

  return { workspace, activeCwd: cwd, spec, identity, refreshCloudState, fileMounts }
}
