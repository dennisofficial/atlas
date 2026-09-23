import { isResumable, type ThreadId } from '@dltech/atlas-core'

import type { StepId } from '../channel/signal'
import { EServeFrame, type ServeFrame, type TurnOutcomeWire } from '../cloud/channel-wire'
import { SessionsClient } from '../cloud/sessions-client'
import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'

import { atlasDirectory } from '../store/paths'

import { createChannelBridge } from './channel-bridge'
import { composeServeApp } from './compose-serve'
import { DEFAULT_DRAIN_DEADLINE_MS, withDeadline } from './drain-deadline'
import { createFrameBuffer, DEFAULT_FRAME_BUFFER, type SignalFrame } from './frame-buffer'
import { createEnvironmentProfile, EProfileStepState } from './environment-profile'
import { applyGitAccessEnv } from './git-access-env'
import { startServeIdleStop } from './idle-stop'
import { materializeContext } from './materialize-context'
import {
  createEnsureWorkspace,
  EWorkspaceState,
  workspaceRefusalOf,
  type EnsureWorkspace,
} from './materialize-workspace'
import {
  workspacePublisherFor,
  type WorkspacePublisher,
} from './publish-workspace'
import type { ServeApp, ServeCompose } from './serve-app'
import { serveConfig } from './serve-config'
import { createServeLog, EServeEvent, LoggingNoticePort, type LogWrite, type ServeLog } from './serve-log'
import { startSessionServer } from './session-server'
import { createSessionHandlers } from './socket-session'
import { createTurnDriver } from './turn-driver'
import type { WorkspaceFiles } from './workspace-files'
import { contextArchiveFetcher, workspaceSpecFetcher } from './workspace-spec'

export * from './channel-bridge'
export * from './compose-serve'
export * from './drain-deadline'
export * from './environment-profile'
export * from './frame-buffer'
export * from './git-access-env'
export * from './idle-stop'
export * from './requests'
export * from './run-command'
export * from './serve-app'
export * from './serve-config'
export * from './serve-session'
export * from './serve-log'
export * from './session-server'
export * from './socket-session'
export * from './step-alias'
export * from './materialize-workspace'
export * from './publish-workspace'
export * from './token-guard'
export * from './turn-driver'
export * from './workspace-files'
export * from './workspace-spec'

/** Everything the sandbox is told at creation falls back to its environment variable. */
export type ServeArgs = {
  threadId?: ThreadId | undefined
  port?: number | undefined
  token?: string | undefined
  controlPlaneUrl?: string | undefined
  cwd?: string | undefined
  model?: string | undefined
  clientVersion?: string | undefined
  env?: Record<string, string | undefined> | undefined
  bufferSize?: number | undefined
  drainDeadlineMs?: number | undefined
  idleMinutes?: number | undefined
  idleMinutesWithServices?: number | undefined
  idleTickMs?: number | undefined
  /** What an idle serve does after closing — injectable so a spec's process survives it. */
  exit?: ((code: number) => void) | undefined
  fetchFn?: typeof fetch | undefined
  write?: LogWrite | undefined
  compose?: ServeCompose | undefined
  ensureWorkspace?: EnsureWorkspace | undefined
  publishWorkspace?: WorkspacePublisher | undefined
  contextFiles?: WorkspaceFiles | undefined
}

export type ServeHandle = {
  port: number
  close: () => Promise<void>
}

const wireOutcomeOf = (outcome: TurnOutcome): TurnOutcomeWire => {
  if (outcome.status !== ETurnStatus.Failed) return outcome
  return { status: outcome.status, runId: outcome.runId, message: outcome.message }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'child adoption failed for a reason it did not name'

function adoptChildrenInBackground(args: {
  app: Pick<ServeApp, 'adoptChildren' | 'whenChildrenSettled'>
  threadId: ThreadId
  log: ServeLog
  settling: { count: number }
  note: () => void
}): void {
  void (async () => {
    const resumed = await args.app.adoptChildren({ threadId: args.threadId })
    if (resumed.length === 0) return

    args.log({ event: EServeEvent.ChildrenAdopted, agentIds: resumed })
    args.settling.count += 1
    args.note()
    try {
      await args.app.whenChildrenSettled({ threadId: args.threadId })
    } finally {
      args.settling.count -= 1
      args.note()
    }
  })().catch((error: unknown) => {
    args.log({ event: EServeEvent.ChildAdoptionFailed, reason: messageOf(error) })
  })
}

const lazy = <T>(fetch: () => Promise<T>): (() => Promise<T>) => {
  let held: Promise<T> | undefined
  return () => (held ??= fetch())
}

/**
 * The thread's own model preference, read from the control plane so the sandbox runs the model the
 * conversation was already on rather than whatever the sandbox's bare settings would default to.
 */
const readThreadModel = async (args: {
  controlPlaneUrl: string
  token: string
  threadId: ThreadId
  fetchFn: typeof fetch
}): Promise<string | undefined> => {
  const client = new SessionsClient({
    url: args.controlPlaneUrl,
    token: args.token,
    clientVersion: 'dev',
    fetchFn: args.fetchFn,
  })
  const thread = await client.findThread({ threadId: args.threadId }).catch(() => undefined)
  return thread?.model?.ref
}

export async function startServe(args: ServeArgs = {}): Promise<ServeHandle> {
  const env = args.env ?? process.env
  const { threadId, port: wanted, token, controlPlaneUrl, cwd } = serveConfig({ ...args, env })
  const startedAt = Date.now()
  const log = createServeLog({ write: args.write })
  const notice = new LoggingNoticePort({ log })
  const fetchFn = args.fetchFn ?? fetch

  const fetchSpecOnce = lazy(workspaceSpecFetcher({ controlPlaneUrl, threadId, token, fetchFn }))

  /**
   * Before anything can read a file: a sandbox boots with whatever its last snapshot held, which on
   * a first attach is nothing at all.
   */
  const workspaceStartedAt = Date.now()
  const ensureWorkspace =
    args.ensureWorkspace ?? createEnsureWorkspace({ profile: createEnvironmentProfile({ env }) })
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
    fetchArchive: contextArchiveFetcher({ controlPlaneUrl, token, fetchFn }),
    atlasHome: atlasDirectory(),
    cwd,
    files: args.contextFiles,
  })
  const contextMs = Date.now() - contextStartedAt
  if (context.failed !== null) {
    log({ event: EServeEvent.ContextFailed, reason: context.failed, ms: contextMs })
  } else if (context.written > 0) {
    log({ event: EServeEvent.ContextReady, written: context.written, ms: contextMs })
  }

  const threadModel = args.model ?? (await readThreadModel({ controlPlaneUrl, token, threadId, fetchFn }))

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
    capabilities: 'profile' in workspace ? workspace.profile?.capabilities : undefined,
    identity: context.identity,
  })

  const buffer = createFrameBuffer({ capacity: args.bufferSize ?? DEFAULT_FRAME_BUFFER })

  const settling = { count: 0 }
  let idleStop: { note: () => void; halt: () => void } = { note: () => undefined, halt: () => undefined }

  adoptChildrenInBackground({ app, threadId, log, settling, note: () => idleStop.note() })

  let inFlight: () => readonly SignalFrame[] = () => []
  let liveStepId: () => StepId | null = () => null
  let broadcast: (frame: ServeFrame) => void = () => undefined

  const driver = createTurnDriver({
    app,
    threadId,
    refusal: () => workspaceRefusalOf(workspace),
    onTurnStarted: () => {
      idleStop.note()
      log({ event: EServeEvent.TurnStarted })
    },
    onTurnEnded: () => {
      idleStop.note()
      app.files.forget()
      void app.syncMemoryAfterTurn().catch(() => undefined)
    },
    onOutcome: (outcome) => {
      log({ event: EServeEvent.TurnEnded, status: outcome.status })
      broadcast({ kind: EServeFrame.TurnEnded, outcome: wireOutcomeOf(outcome) })
    },
    onFailure: (reason) => {
      log({ event: EServeEvent.TurnFailed, reason })
      broadcast({ kind: EServeFrame.Error, message: reason })
    },
  })

  const publishWorkspace: WorkspacePublisher =
    args.publishWorkspace ??
    workspacePublisherFor({
      workspace,
      threadId,
      // Deliberately not fetchSpecOnce: the token rides the spec, and a GitHub reconnect mints a
      // new one — a publisher that cached the boot-time spec would wedge every descend until the
      // sandbox process died (that wedged a real session on 2026-09-19).
      fetchSpec: workspaceSpecFetcher({ controlPlaneUrl, threadId, token, fetchFn }),
      cwd,
    })

  const handlers = createSessionHandlers({
    threadId,
    buffer,
    inFlight: () => inFlight(),
    liveStepId: () => liveStepId(),
    driver,
    files: app.files,
    publish: publishWorkspace,
    refusal: () => workspaceRefusalOf(workspace) ?? null,
    log,
  })

  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: handlers.broadcast,
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId
  broadcast = handlers.broadcast

  /**
   * A turn cut short by the container stopping leaves its events durable and nothing else, so the
   * one thing boot owes a client is to say the thread is mid-turn rather than to look alive.
   */
  const events = await app.log.read({ threadId }).catch(() => [])
  const resumable = isResumable(events)
  if (resumable) log({ event: EServeEvent.Resumable, head: events.at(-1)?.seq ?? 0 })

  const server = startSessionServer({
    port: wanted,
    token,
    handlers,
    health: () => ({
      ok: workspace.state !== EWorkspaceState.Failed,
      threadId,
      uptimeMs: Date.now() - startedAt,
      clients: handlers.clients(),
      turnRunning: driver.running(),
      nextSeq: buffer.nextSeq(),
      resumable,
      workspace,
    }),
  })

  const port = server.port ?? wanted
  log({ event: EServeEvent.Started, threadId, port, ms: Date.now() - startedAt })

  const close = async (): Promise<void> => {
    idleStop.halt()
    driver.interrupt()
    await withDeadline({
      task: driver.settled().catch(() => undefined),
      ms: args.drainDeadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS,
    })
    bridge.close()
    handlers.hangUp()
    /**
     * Bun 1.3.14: the promise `stop` returns never settles once the server has itself closed a
     * WebSocket, though the listener does stop and the port is released. Awaiting it hangs.
     */
    void server.stop(true)
    await app.close()
    log({ event: EServeEvent.Stopped, threadId })
  }

  idleStop = startServeIdleStop({
    turnRunning: () => driver.running(),
    childrenSettling: () => settling.count > 0,
    runningShells: () => app.runningShells?.() ?? 0,
    runningServices: () => app.runningServices?.() ?? 0,
    idleMinutes: args.idleMinutes,
    idleMinutesWithServices: args.idleMinutesWithServices,
    tickMs: args.idleTickMs,
    log: (line) => log({ event: EServeEvent.IdleCheckFailed, reason: line }),
    onDue: () => {
      log({ event: EServeEvent.IdleStop, threadId })
      void close().then(() => (args.exit ?? process.exit)(0))
    },
  })

  return { port, close }
}
