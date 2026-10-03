import type { StepId } from '@dltech/atlas-harness'
import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { atlasDirectory } from '@dltech/atlas-harness'

import { createChannelBridge } from './channel-bridge'
import { DEFAULT_DRAIN_DEADLINE_MS } from './drain-deadline'
import { settleDirectArrival } from './direct-arrival'
import { createFrameBuffer, DEFAULT_FRAME_BUFFER, type LifecycleFrame, type SignalFrame } from './frame-buffer'
import { startServeIdleStop } from './idle-stop'
import { hydrateCloudPlacement } from './placement-hydration'
import { EWorkspaceState, workspaceRefusalOf } from './materialize-workspace'
import { createRuntimeCheckpointCapture } from './runtime-checkpoint'
import { bindRuntimeCheckpoint } from './runtime-checkpoint-binding'
import { runtimeWork } from './runtime-work'
import { sandboxPark } from './sandbox-park'
import type { ServeArgs, ServeHandle } from './serve-args'
import { announceBoot } from './serve-announce'
import { bootServeFiles } from './serve-boot'
import { composeBootApp } from './serve-compose-boot'
import { serveConfig } from './serve-config'
import { bindServeDrain } from './serve-drain-binding'
import { createServeLifecycle } from './serve-lifecycle'
import { createServeDriver } from './serve-driver'
import { handlerOptionsOf } from './serve-handler-options'
import { createServeLog, EServeEvent, LoggingNoticePort } from './serve-log'
import { createTranscriptRestorer } from './serve-restore'
import { subscribeThreadBroadcasts } from './serve-thread-broadcasts'
import { subscribeLegacyWake } from './serve-wake'
import { startSessionServer } from './session-server'
import { createSessionHandlers } from './socket-session'
import { createServeWorkspaceSession } from './serve-workspace-session'

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
      ensureWorkspace: args.ensureWorkspace,
      restoreWorkspace: args.restoreWorkspace,
      profile: args.profile,
      contextFiles: args.contextFiles,
      fetchTranscriptArchive: args.fetchTranscriptArchive,
    })

  const app = await composeBootApp({
    compose: args.compose,
    model: args.model,
    spec,
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
  const noop = (): void => undefined
  let idleStop: { note: () => void; halt: () => void; reset: () => void } = { note: noop, halt: noop, reset: noop }
  const admission = { closed: false }
  const note = (): void => idleStop.note()

  const session = createServeWorkspaceSession({
    direct,
    driveHome,
    threadId,
    activeCwd,
    app,
    capture: args.captureWorkspace,
    dormant: bootDormant,
    log,
    settling,
    note,
  })

  let inFlight: () => readonly SignalFrame[] = () => []
  let liveStepId: () => StepId | null = () => null
  let broadcast: (frame: ServeFrame) => void = noop
  let captureRunning: () => void = noop

  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({
      threadId,
      atlasHome: driveHome,
      env,
      token,
      transcript: app.log,
      log,
      fetchFn,
    }),
    log,
    publish: (current) => broadcast({ kind: EServeFrame.Checkpoint, checkpoint: current }),
  })
  captureRunning = checkpoint.running

  const emitLifecycle = (frame: LifecycleFrame): void => {
    buffer.pushLifecycle(frame)
    broadcast(frame)
    captureRunning()
  }

  const driver = createServeDriver({ app, threadId, workspace, session, admission, log, idleStop: () => idleStop, emitLifecycle })

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

  const handlers = createSessionHandlers({
    threadId,
    buffer,
    inFlight: () => inFlight(),
    liveStepId: () => liveStepId(),
    driver,
    files: app.files,
    admissionClosed: () => admission.closed,
    checkpoint: checkpoint.current,
    checkpointChanged: () => captureRunning(),
    refusal: () => workspaceRefusalOf(workspace) ?? null,
    workspace: { prepare: session.prepare, apply: session.apply, activate: session.activate },
    log,
    roster: app.roster,
    rewind: app.rewind,
    agents: app.agents,
    operatorInput: app.operatorInput,
    pending: app.pending,
    ...handlerOptionsOf({ app, log }),
    restoreTranscript: createTranscriptRestorer({
      app,
      threadId,
      driveHome,
      direct,
      activeCwd,
      log,
      settling,
      dormant: session.dormant,
      note,
      fetchTranscriptArchive: args.fetchTranscriptArchive,
    }),
  })

  const unsubscribeThreads = subscribeThreadBroadcasts({ threads: app.threads, broadcast: handlers.broadcast })

  // Watching surfaces (footer chips, sidebar crew) read the roster off the wire, so a change on
  // the live registries is pushed the moment the registries announce it, not on the next request.
  const unsubscribeRoster = app.roster?.subscribe(() => {
    idleStop.note()
    captureRunning()
    handlers.broadcastRoster()
  })
  const unsubscribePending = app.pending?.subscribe(note)

  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: (frame) => {
      handlers.broadcast(frame)
      if (frame.kind !== EServeFrame.Signal) return
      if (frame.signal.type === 'events-appended' || frame.signal.type === 'step-ended') captureRunning()
    },
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId
  broadcast = handlers.broadcast

  const work = () => {
    const activity = runtimeWork({ app, driver, settling: settling.count })
    return { ...activity, settlingWork: activity.settlingWork || handlers.settling() }
  }

  const { resumable } = await announceBoot({ app, threadId, log })
  await checkpoint.boot().catch((failure: unknown) => {
    log({
      event: EServeEvent.CheckpointPersistFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
  })

  const exit = args.exit ?? process.exit
  const drain = bindServeDrain({
    app,
    driver,
    threadId,
    admission,
    haltIdle: () => idleStop.halt(),
    checkpoint,
    close: (given) => lifecycle.close(given),
    exit,
    log,
  })

  const server = startSessionServer({
    port: wanted,
    token,
    handlers,
    drain,
    health: () => ({
      ok: workspace.state !== EWorkspaceState.Failed,
      threadId,
      uptimeMs: Date.now() - startedAt,
      clients: handlers.clients(),
      ...work(),
      nextSeq: buffer.nextSeq(),
      resumable,
      workspace,
    }),
  })

  const port = server.port ?? wanted
  log({ event: EServeEvent.Started, threadId, port, ms: Date.now() - startedAt })

  const lifecycle = createServeLifecycle({
    app,
    driver,
    handlers,
    server,
    bridge,
    threadId,
    admission,
    log,
    work,
    haltIdle: () => idleStop.halt(),
    rearmIdle: () => idleStop.reset(),
    drainDeadlineMs: args.drainDeadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS,
    detach: () => {
      detachIntake?.()
      unsubscribeWake?.()
      unsubscribeRoster?.()
      unsubscribeThreads?.()
      unsubscribePending?.()
    },
    stopSandbox: args.stopSandbox ?? sandboxPark({ threadId, controlPlaneUrl, env }),
    exit,
    finalizePark: checkpoint.finalizePark,
  })

  idleStop = startServeIdleStop({
    turnRunning: driver.busy,
    childrenSettling: () => work().settlingWork,
    runningChildren: () => work().childrenRunning,
    runningShells: () => work().shellsRunning,
    runningServices: () => work().servicesRunning,
    pendingInput: () => work().pendingInput,
    idleMinutes: args.idleMinutes,
    tickMs: args.idleTickMs,
    log: (line) => log({ event: EServeEvent.IdleCheckFailed, reason: line }),
    onDue: () => void lifecycle.park(),
  })

  return { port, close: (shutdown) => lifecycle.close({ reason: shutdown?.reason ?? 'owner-shutdown' }) }
}
