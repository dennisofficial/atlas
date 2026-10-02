import type { StepId } from '@dltech/atlas-harness'
import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { atlasDirectory } from '@dltech/atlas-harness'

import { createChannelBridge } from './channel-bridge'
import { DEFAULT_DRAIN_DEADLINE_MS, withDeadline } from './drain-deadline'
import { settleDirectArrival } from './direct-arrival'
import { createFrameBuffer, DEFAULT_FRAME_BUFFER, type LifecycleFrame, type SignalFrame } from './frame-buffer'
import { startServeIdleStop } from './idle-stop'
import { hydrateCloudPlacement } from './placement-hydration'
import { EWorkspaceState, workspaceRefusalOf } from './materialize-workspace'
import type { WorkspacePublisher } from './publish-workspace'
import type { ServeArgs, ServeHandle } from './serve-args'
import { announceBoot } from './serve-announce'
import { adoptChildrenNow, settleLostShellsInBackground } from './serve-background'
import { bootServeFiles } from './serve-boot'
import { composeBootApp } from './serve-compose-boot'
import { serveConfig } from './serve-config'
import { DORMANT_REFUSAL, wireOutcomeOf } from './serve-outcome'
import { handlerOptionsOf } from './serve-handler-options'
import { createServeLog, EServeEvent, LoggingNoticePort } from './serve-log'
import { createTranscriptRestorer } from './serve-restore'
import { subscribeThreadBroadcasts } from './serve-thread-broadcasts'
import { subscribeLegacyWake } from './serve-wake'
import { startSessionServer } from './session-server'
import { createSessionHandlers } from './socket-session'
import { createTurnDriver } from './turn-driver'
import { createWorkspaceSession } from './workspace-session'

export * from './serve-args'
export * from './capabilities-notice'
export * from './drive-bootstrap'
export * from './channel-bridge'
export * from './compose-serve'
export * from './drain-deadline'
export * from './environment-profile'
export * from './frame-buffer'
export * from './git-access-env'
export * from './idle-stop'
export * from './requests'
export * from './rewind-apply'
export * from './run-command'
export * from './serve-app'
export * from './serve-config'
export * from './portable-state'
export * from './serve-log'
export * from './session-server'
export * from './socket-session'
export * from './step-alias'
export * from './materialize-workspace'
export * from './materialize-transcript'
export * from './restore-transcript'
export * from './transcript-bootstrap'
export * from './placement-hydration'
export * from './publish-workspace'
export * from './token-guard'
export * from './turn-driver'
export * from './workspace-files'
export * from './direct-workspace'
export * from './prepare-workspace'
export * from './workspace-ops'
export * from './workspace-session'
export * from './workspace-hooks'
export * from './workspace-spec'

export async function startServe(args: ServeArgs = {}): Promise<ServeHandle> {
  const env = args.env ?? process.env
  const { threadId, port: wanted, token, controlPlaneUrl, cwd } = serveConfig({ ...args, env })
  const startedAt = Date.now()
  const log = createServeLog({ write: args.write })
  const notice = new LoggingNoticePort({ log })
  const fetchFn = args.fetchFn ?? fetch

  const driveHome = atlasDirectory()
  const { direct, directBoot, workspace, activeCwd, bootDormant, spec, context } =
    await bootServeFiles({
      env,
      threadId,
      cwd,
      driveHome,
      log,
      idleMinutesWithServices: args.idleMinutesWithServices,
      ensureWorkspace: args.ensureWorkspace,
      restoreWorkspace: args.restoreWorkspace,
      contextFiles: args.contextFiles,
      fetchTranscriptArchive: args.fetchTranscriptArchive,
    })

  const app = await composeBootApp({
    compose: args.compose,
    model: args.model,
    spec,
    workspace,
    context,
    threadId,
    cwd: activeCwd,
    driveHome,
    controlPlaneUrl,
    token,
    clientVersion: args.clientVersion ?? 'dev',
    env,
    notice,
  })
  const capabilities = 'profile' in workspace ? workspace.profile?.capabilities : undefined

  await hydrateCloudPlacement({ app, threadId })

  const bootReceipt = directBoot.kind === 'ready' ? await direct.receipt() : null
  if (bootReceipt?.arrivalPending === true) {
    await settleDirectArrival({
      direct,
      app,
      threadId,
      restored: bootReceipt.restored,
      launchDirectory: activeCwd,
    })
  }

  const buffer = createFrameBuffer({ capacity: args.bufferSize ?? DEFAULT_FRAME_BUFFER })

  const settling = { count: 0 }
  let idleStop: { note: () => void; halt: () => void } = { note: () => undefined, halt: () => undefined }

  const startChildren = async (): Promise<void> => {
    await adoptChildrenNow({ app, threadId, log, settling, note: () => idleStop.note() })
    settleLostShellsInBackground({ app, threadId, log })
  }
  const session = createWorkspaceSession({
    direct,
    driveHome,
    threadId,
    launchDirectory: () => direct.activeCwd() ?? activeCwd,
    app,
    capture: args.captureWorkspace,
    dormant: bootDormant,
    startChildren,
  })
  if (!session.dormant()) {
    void startChildren().catch((error: unknown) => {
      log({ event: EServeEvent.ChildAdoptionFailed, reason: error instanceof Error ? error.message : String(error) })
    })
  }

  let inFlight: () => readonly SignalFrame[] = () => []
  let liveStepId: () => StepId | null = () => null
  let broadcast: (frame: ServeFrame) => void = () => undefined

  const emitLifecycle = (frame: LifecycleFrame): void => {
    buffer.pushLifecycle(frame)
    broadcast(frame)
  }

  const driver = createTurnDriver({
    app,
    threadId,
    refusal: () => workspaceRefusalOf(workspace) ?? (session.dormant() ? DORMANT_REFUSAL : undefined),
    onTurnStarted: () => {
      idleStop.note()
      log({ event: EServeEvent.TurnStarted })
    },
    onTurnEnded: () => {
      idleStop.note()
      app.files.forget()
    },
    onOutcome: (outcome) => {
      log({ event: EServeEvent.TurnEnded, status: outcome.status })
      emitLifecycle({ kind: EServeFrame.TurnEnded, outcome: wireOutcomeOf(outcome) })
    },
    onFailure: (reason) => {
      log({ event: EServeEvent.TurnFailed, reason })
      emitLifecycle({ kind: EServeFrame.Error, message: reason })
    },
  })

  /**
   * The serve's driver rides the shared message intake: an ending or a queued message that lands
   * while no turn is running starts one, and the turn's own drain delivers what was waiting.
   * A legacy fake without an intake keeps its wake noticer instead.
   */
  const detachIntake = app.intake === undefined ? undefined : driver.attach(app.intake)
  const unsubscribeWake = subscribeLegacyWake({
    app,
    threadId,
    running: driver.running,
    onWake: () => {
      idleStop.note()
      driver.sayOrRun()
    },
  })

  const publishWorkspace: WorkspacePublisher =
    args.publishWorkspace ??
    (async () => {
      throw new Error('this serve transfers workspaces as archives; publish-workspace is retired')
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
    workspace: { prepare: session.prepare, apply: session.apply, activate: session.activate },
    log,
    roster: app.roster,
    rewind: app.rewind,
    ...handlerOptionsOf(app),
    restoreTranscript: createTranscriptRestorer({
      app,
      threadId,
      driveHome,
      direct,
      activeCwd,
      log,
      settling,
      dormant: session.dormant,
      note: () => idleStop.note(),
      fetchTranscriptArchive: args.fetchTranscriptArchive,
    }),
  })

  const unsubscribeThreads = subscribeThreadBroadcasts({ threads: app.threads, broadcast: handlers.broadcast })

  // Watching surfaces (footer chips, sidebar crew) read the roster off the wire, so a change on
  // the live registries is pushed the moment the registries announce it, not on the next request.
  const unsubscribeRoster = app.roster?.subscribe(() => handlers.broadcastRoster())

  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: handlers.broadcast,
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId
  broadcast = handlers.broadcast

  const { resumable } = await announceBoot({ app, threadId, capabilities, log })

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
    detachIntake?.()
    unsubscribeWake?.()
    unsubscribeRoster?.()
    unsubscribeThreads?.()
    driver.interrupt()
    await withDeadline({
      task: driver.settled().catch(() => undefined),
      ms: args.drainDeadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS,
    })
    bridge.close()
    handlers.hangUp()
    await server.stop(true)
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
