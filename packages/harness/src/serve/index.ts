import { isResumable, type ThreadId } from '@dltech/atlas-core'

import type { StepId } from '../channel/signal'

import { createChannelBridge } from './channel-bridge'
import { composeServeApp } from './compose-serve'
import { createFrameBuffer, DEFAULT_FRAME_BUFFER, type SignalFrame } from './frame-buffer'
import { createHeartbeat } from './heartbeat'
import {
  ensureWorkspace as materializeWorkspace,
  EWorkspaceState,
  workspaceRefusalOf,
  type EnsureWorkspace,
} from './materialize-workspace'
import type { ServeCompose } from './serve-app'
import { serveConfig } from './serve-config'
import { createServeLog, EServeEvent, LoggingNoticePort, type LogWrite } from './serve-log'
import { startSessionServer } from './session-server'
import { createSessionHandlers } from './socket-session'
import { createTurnDriver } from './turn-driver'
import { workspaceSpecFetcher } from './workspace-spec'

export * from './channel-bridge'
export * from './compose-serve'
export * from './frame-buffer'
export * from './heartbeat'
export * from './requests'
export * from './serve-app'
export * from './serve-config'
export * from './serve-log'
export * from './session-server'
export * from './socket-session'
export * from './step-alias'
export * from './materialize-workspace'
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
  heartbeatIntervalMs?: number | undefined
  fetchFn?: typeof fetch | undefined
  write?: LogWrite | undefined
  compose?: ServeCompose | undefined
  ensureWorkspace?: EnsureWorkspace | undefined
}

export type ServeHandle = {
  port: number
  close: () => Promise<void>
}

export async function startServe(args: ServeArgs = {}): Promise<ServeHandle> {
  const env = args.env ?? process.env
  const { threadId, port: wanted, token, controlPlaneUrl, cwd } = serveConfig({ ...args, env })
  const startedAt = Date.now()
  const log = createServeLog({ write: args.write })
  const notice = new LoggingNoticePort({ log })
  const fetchFn = args.fetchFn ?? fetch

  /**
   * Before anything can read a file: a sandbox boots with whatever its last snapshot held, which on
   * a first attach is nothing at all.
   */
  const workspace = await (args.ensureWorkspace ?? materializeWorkspace)({
    cwd,
    fetchSpec: workspaceSpecFetcher({ controlPlaneUrl, threadId, token, fetchFn }),
  })

  if (workspace.state === EWorkspaceState.Failed) {
    log({ event: EServeEvent.WorkspaceFailed, step: workspace.step, reason: workspace.reason })
  } else {
    log({ event: EServeEvent.WorkspaceReady, state: workspace.state, cwd })
  }

  const app = await (args.compose ?? composeServeApp)({
    threadId,
    cwd,
    controlPlaneUrl,
    token,
    clientVersion: args.clientVersion ?? 'dev',
    env,
    model: args.model,
    notice,
  })

  const buffer = createFrameBuffer({ capacity: args.bufferSize ?? DEFAULT_FRAME_BUFFER })

  const heartbeat = createHeartbeat({
    controlPlaneUrl,
    threadId,
    token,
    fetchFn,
    intervalMs: args.heartbeatIntervalMs,
    onFailure: (reason) => log({ event: EServeEvent.HeartbeatFailed, reason }),
  })

  let inFlight: () => readonly SignalFrame[] = () => []
  let liveStepId: () => StepId | null = () => null

  const driver = createTurnDriver({
    app,
    threadId,
    refusal: () => workspaceRefusalOf(workspace),
    onTurnStarted: () => {
      heartbeat.turnStarted()
      log({ event: EServeEvent.TurnStarted })
    },
    onTurnEnded: () => {
      heartbeat.turnEnded()
      app.files.forget()
    },
    onOutcome: (outcome) => log({ event: EServeEvent.TurnEnded, status: outcome.status }),
    onFailure: (reason) => log({ event: EServeEvent.TurnFailed, reason }),
  })

  const handlers = createSessionHandlers({
    threadId,
    buffer,
    inFlight: () => inFlight(),
    liveStepId: () => liveStepId(),
    driver,
    files: app.files,
    log,
  })

  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: handlers.broadcast,
    onToolOutput: heartbeat.beat,
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId

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
  log({ event: EServeEvent.Started, threadId, port })

  return {
    port,
    close: async () => {
      driver.interrupt()
      await driver.settled().catch(() => undefined)
      bridge.close()
      heartbeat.stop()
      handlers.hangUp()
      /**
       * Bun 1.3.14: the promise `stop` returns never settles once the server has itself closed a
       * WebSocket, though the listener does stop and the port is released. Awaiting it hangs.
       */
      void server.stop(true)
      await app.close()
      log({ event: EServeEvent.Stopped, threadId })
    },
  }
}
