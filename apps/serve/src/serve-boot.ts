import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

import {
  EExecutionLocation,
  type NoticePort,
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
import { createContainerSetup, type ContainerSetup } from './container-setup'
import { applyCloudInstructions, startInstructionsFetch } from './cloud-instructions'
import { startCloudStateFetch } from './cloud-state-fetch'
import { createCloudStateRefresh } from './cloud-state-refresh'
import { applyGitAccessEnv } from './git-access-env'
import {
  createEnsureWorkspace,
  EWorkspaceState,
  type EnsureWorkspace,
  type WorkspaceReadiness,
} from './materialize-workspace'
import { projectWorkspaceSpecFetcher } from './project-workspace-spec'
import { applyPublishedBundle, startBundleFetch } from './published-bundle'
import { applySigningKey, startSigningKeyFetch } from './signing-key-env'
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
  notice?: NoticePort | undefined
  containerSetup?: ContainerSetup | undefined
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

  const remote = {
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  }
  const prefetchedSigningKey = startSigningKeyFetch(remote)
  const prefetchedBundle = startBundleFetch(remote)
  const prefetchedInstructions = startInstructionsFetch(remote)
  const prefetchedCloudState = fetchSpecOnce()
    .catch(() => null)
    .then((early) => startCloudStateFetch({ ...remote, projectId: early?.projectId ?? null }))
  prefetchedCloudState.catch(() => undefined)

  const workspaceStartedAt = Date.now()
  const cwd = await resolveWorkspaceDir({
    atlasHome,
    fetchSpec: fetchSpecOnce,
  })
  const profile = args.profile ?? createEnvironmentProfile({ env })
  const ensureWorkspace = args.ensureWorkspace ?? createEnsureWorkspace({ profile })
  const workspace: WorkspaceReadiness = await trackClone({
    reporter,
    work: (progress) => ensureWorkspace({ cwd, fetchSpec: fetchSpecOnce, progress }),
  })
  const workspaceMs = Date.now() - workspaceStartedAt
  log({ event: EServeEvent.BootPhase, phase: 'clone', ms: workspaceMs })

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
    log({
      event: EServeEvent.WorkspaceReady,
      state: workspace.state,
      cwd,
      ms: workspaceMs,
    })
    for (const outcome of workspace.profile?.steps ?? []) {
      if (outcome.state !== EProfileStepState.Failed) continue
      log({
        event: EServeEvent.ProfileStepFailed,
        step: outcome.step,
        detail: outcome.detail,
      })
    }
  }

  const setupStartedAt = Date.now()
  const spec = await fetchSpecOnce().catch(() => null)
  applyGitAccessEnv({ env, cwd, githubToken: spec?.githubToken })
  if (workspace.state !== EWorkspaceState.Failed && args.notice !== undefined) {
    const applyContainer = args.containerSetup ?? createContainerSetup({})
    await applyContainer({
      cwd,
      atlasHome,
      env,
      setupScript: spec?.setupScript,
      notice: args.notice,
    }).catch(() => undefined)
  }
  if (spec?.projectId && !spec.githubToken) {
    log({ event: EServeEvent.GithubTokenAbsent, projectId: spec.projectId })
  }
  log({ event: EServeEvent.BootPhase, phase: 'setup', ms: Date.now() - setupStartedAt })
  const signingStartedAt = Date.now()
  await applySigningKey({ env, atlasHome, log, ...remote, prefetched: prefetchedSigningKey })
  log({ event: EServeEvent.BootPhase, phase: 'signing', ms: Date.now() - signingStartedAt })
  const refreshCloudState = createCloudStateRefresh({
    atlasHome,
    log,
    env,
    projectId: spec?.projectId ?? null,
    ...remote,
    fileMountRoots: {
      repositoryDir:
        workspace.state === EWorkspaceState.Failed || workspace.state === EWorkspaceState.Skipped
          ? null
          : cwd,
      homeDir: env.HOME ?? homedir(),
    },
  })
  const settingsStartedAt = Date.now()
  const fileMounts = await reporter.track({
    step: EBootStep.Settings,
    work: () => refreshCloudState.boot(prefetchedCloudState),
  })
  log({ event: EServeEvent.BootPhase, phase: 'settings', ms: Date.now() - settingsStartedAt })

  const identity =
    spec === null || spec.remoteUrl === null ? null : normalizeRepoOrigin(spec.remoteUrl)
  const contextStartedAt = Date.now()
  await reporter.track({
    step: EBootStep.Context,
    work: async () => {
      const context = { atlasHome, ...remote, log, files: args.contextFiles }
      await applyPublishedBundle({
        ...context,
        projectDirectory: cwd,
        prefetched: prefetchedBundle,
      })
      await applyCloudInstructions({ ...context, prefetched: prefetchedInstructions })
    },
  })
  log({ event: EServeEvent.BootPhase, phase: 'context', ms: Date.now() - contextStartedAt })

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
