import type { ThreadId } from '@dltech/atlas-core'

import { EExecutionLocation } from '@dltech/atlas-core'

import { atlasDirectory, newThreadMeta, readMetaSync, registryFor } from '@dltech/atlas-harness'
import { sessionDirectory, threadMetaFile, threadMetaSchema } from '@dltech/atlas-harness'
import { writeMeta, writeSessionMetaForRoot } from '@dltech/atlas-harness'

import { composeServeApp } from './compose-serve'
import type { ServeCompose } from './serve-app'
import { createEnvironmentProfile, EProfileStepState } from './environment-profile'
import { applyGitAccessEnv } from './git-access-env'
import {
  driveContextArchiveFetcher,
  driveTranscriptArchiveFetcher,
  driveWorkspaceSpecFetcher,
} from './drive-bootstrap'
import { materializeContext } from './materialize-context'
import { materializeTranscript } from './materialize-transcript'
import { hydrateCloudPlacement } from './placement-hydration'
import { createEnsureWorkspace, EWorkspaceState } from './materialize-workspace'
import { serveConfig } from './serve-config'
import { createServeLog, EServeEvent, LoggingNoticePort, type LogWrite } from './serve-log'

import type { EnsureWorkspace } from './materialize-workspace'
import type { WorkspacePublisher } from './publish-workspace'
import type { WorkspaceFiles } from './workspace-files'
import type { FetchTranscriptArchive } from './workspace-spec'

/** Everything the sandbox is told at creation falls back to its environment variable. */
export type ServeArgs = {
  threadId?: ThreadId | undefined
  port?: number | undefined
  token?: string | undefined
  controlPlaneUrl?: string | undefined
  cwd?: string | undefined
  model?: { ref: string; effort?: string | undefined } | undefined
  clientVersion?: string | undefined
  env?: Record<string, string | undefined> | undefined
  bufferSize?: number | undefined
  drainDeadlineMs?: number | undefined
  idleMinutes?: number | undefined
  idleTickMs?: number | undefined
  /** What an idle serve does after closing — injectable so a spec's process survives it. */
  exit?: ((code: number) => void) | undefined
  stopSandbox?: (() => Promise<void>) | undefined
  fetchFn?: typeof fetch | undefined
  write?: LogWrite | undefined
  compose?: ServeCompose | undefined
  ensureWorkspace?: EnsureWorkspace | undefined
  publishWorkspace?: WorkspacePublisher | undefined
  contextFiles?: WorkspaceFiles | undefined
  fetchTranscriptArchive?: FetchTranscriptArchive | undefined
}

const lazy = <T>(fetch: () => Promise<T>): (() => Promise<T>) => {
  let held: Promise<T> | undefined
  return () => (held ??= fetch())
}

export type ServeBootstrap = Awaited<ReturnType<typeof bootstrapServe>>

export async function bootstrapServe(args: ServeArgs = {}) {
  const env = args.env ?? process.env
  const { threadId, port: wanted, token, controlPlaneUrl, cwd } = serveConfig({ ...args, env })
  const startedAt = Date.now()
  const log = createServeLog({ write: args.write })
  const notice = new LoggingNoticePort({ log })
  const fetchFn = args.fetchFn ?? fetch

  const driveHome = atlasDirectory()
  const fetchSpecOnce = lazy(driveWorkspaceSpecFetcher({ driveHome }))

  const workspaceStartedAt = Date.now()
  const ensureWorkspace =
    args.ensureWorkspace ??
    createEnsureWorkspace({
      profile: createEnvironmentProfile({ env }),
    })
  const workspace = await ensureWorkspace({
    cwd,
    fetchSpec: fetchSpecOnce,
  })
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
    cwd,
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
  if (transcript.restored) {
    log({ event: EServeEvent.TranscriptRestored, ms: transcriptMs })
  }
  if (transcript.fresh) {
    const sessionDir = sessionDirectory({ home: driveHome, sessionId: threadId })
    const at = new Date().toISOString()
    const meta = newThreadMeta({ id: threadId, at })
    meta.workspace = cwd
    await writeMeta({ file: threadMetaFile({ sessionDir, threadId }), meta })
    await writeSessionMetaForRoot({
      registry: registryFor({ home: driveHome }),
      sessionDir,
      root: meta,
      home: EExecutionLocation.Cloud,
    })
  }

  const storedThreadModel = (): { ref: string; effort?: string | undefined } | undefined => {
    const meta = readMetaSync({
      file: threadMetaFile({
        sessionDir: sessionDirectory({ home: driveHome, sessionId: threadId }),
        threadId,
      }),
      schema: threadMetaSchema,
    })
    if (meta === undefined || meta.modelRef === null) return undefined
    return { ref: meta.modelRef, effort: meta.modelEffort ?? undefined }
  }

  const threadModel =
    args.model ??
    storedThreadModel() ??
    (spec?.model === undefined || spec.model === null ? undefined : { ref: spec.model })

  const app = await (args.compose ?? composeServeApp)({
    threadId,
    cwd,
    controlPlaneUrl,
    token,
    clientVersion: args.clientVersion ?? 'dev',
    env,
    model: threadModel,
    notice,
    projectDirectory: context.projectDirectory,
    identity: context.identity,
  })

  await hydrateCloudPlacement({ app, threadId })

  return {
    env,
    threadId,
    token,
    controlPlaneUrl,
    wanted,
    startedAt,
    log,
    fetchFn,
    driveHome,
    cwd,
    workspace,
    app,
  }
}
