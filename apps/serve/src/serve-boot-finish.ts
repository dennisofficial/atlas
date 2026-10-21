import { EServeFrame, createSessionContextReader, sessionDirectory, type ServeFrame, type StepId } from '@dltech/atlas-harness'
import { admissionClosedFor, EBootStep } from '@dltech/atlas-wire'

import type { ThreadId } from '@dltech/atlas-core'

import { createChannelBridge } from './channel-bridge'
import { DEFAULT_DRAIN_DEADLINE_MS } from './drain-deadline'
import { createFrameBuffer, DEFAULT_FRAME_BUFFER, type LifecycleFrame, type SignalFrame } from './frame-buffer'
import { startServeIdleStop } from './idle-stop'
import { workspaceRefusalOf } from './materialize-workspace'
import { createRuntimeCheckpointCapture } from './runtime-checkpoint'
import { bindRuntimeCheckpoint } from './runtime-checkpoint-binding'
import { runtimeWork } from './runtime-work'
import { providerStopFor } from './sandbox-park'
import type { ServeArgs, ServeHandle } from './serve-args'
import { announceBoot } from './serve-announce'
import { bootServeFiles } from './serve-boot'
import { bootReporterFor } from './serve-boot-reporter'
import type { BootListener } from './serve-boot-listener'
import { composeBootApp } from './serve-compose-boot'
import { bindServeDrain } from './serve-drain-binding'
import { createServeLifecycle } from './serve-lifecycle'
import { createServeDriver } from './serve-driver'
import { handlerOptionsOf } from './serve-handler-options'
import { EServeEvent, type LoggingNoticePort, type ServeLog } from './serve-log'
import { createServeRotationRecovery } from './serve-rotation-recovery'
import { bindServeSubscriptions } from './serve-subscriptions'
import { subscribeLegacyWake } from './serve-wake'
import { createSessionHandlers } from './socket-session'
import { createServeWorkspaceSession } from './serve-workspace-session'
import { createSessionMirrorReader } from './session-mirror'
import { createSessionMirrorRevision } from './session-mirror-revision'

export async function finishServeBoot(args: {
  serveArgs: ServeArgs
  env: Record<string, string | undefined>
  threadId: ThreadId
  token: string
  controlPlaneUrl: string
  cwd: string
  startedAt: number
  log: ServeLog
  notice: LoggingNoticePort
  atlasHome: string
  sandboxSessionId: string
  boot: BootListener
}): Promise<ServeHandle> {
  const { serveArgs, env, threadId, token, controlPlaneUrl, cwd, startedAt, log, notice } = args
  const { atlasHome, sandboxSessionId, boot } = args
  const { server, port } = boot
  const fetchFn = serveArgs.fetchFn ?? fetch
  const clientVersion = serveArgs.clientVersion ?? 'dev'
  const reporter = bootReporterFor({ env, controlPlaneUrl, threadId, token, clientVersion, fetchFn, log })
  const recovery = await createServeRotationRecovery({ atlasHome, threadId, sandboxSessionId, log })
  const { workspace, activeCwd, spec, identity } = await bootServeFiles({
    env,
    threadId,
    cwd,
    atlasHome,
    log,
    ensureWorkspace: serveArgs.ensureWorkspace,
    profile: serveArgs.profile,
    contextFiles: serveArgs.contextFiles,
    controlPlaneUrl,
    token,
    clientVersion,
    fetchFn,
    reporter,
  })

  const app = await reporter.track({
    step: EBootStep.Agent,
    work: () =>
      composeBootApp({
        compose: serveArgs.compose,
        model: serveArgs.model,
        spec,
        identity,
        threadId,
        cwd: activeCwd,
        atlasHome,
        controlPlaneUrl,
        token,
        clientVersion,
        env,
        notice,
      }),
  })

  const admissionClosed = (): boolean => {
    if (recovery.admissionLatched) return true
    const current = checkpoint.current()
    return current !== null && admissionClosedFor(current.phase)
  }

  const buffer = createFrameBuffer({ capacity: serveArgs.bufferSize ?? DEFAULT_FRAME_BUFFER })
  const settling = { count: 0 }, noop = (): void => undefined
  let idleStop: { note: () => void; halt: () => void; reset: () => void } = { note: noop, halt: noop, reset: noop }
  const note = (): void => idleStop.note()
  const session = createServeWorkspaceSession({
    threadId,
    app,
    ...(app.toolEffect === undefined ? {} : { toolEffect: app.toolEffect }),
    deferStartChildren: recovery.deferred,
    resumeChildren: recovery.resumeChildren,
    log,
    settling,
    note,
  })

  let inFlight: () => readonly SignalFrame[] = () => []
  let liveStepId: () => StepId | null = () => null
  let broadcast: (frame: ServeFrame) => void = noop
  let captureRunning: () => void = noop
  const mirrorRevision = createSessionMirrorRevision({
    buffer,
    broadcast: (frame) => broadcast(frame),
    startsAt: 1,
  })

  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({
      threadId,
      atlasHome,
      env,
      token,
      transcript: app.log,
      log,
      fetchFn,
    }),
    log,
    publish: (current) => broadcast({ kind: EServeFrame.Checkpoint, checkpoint: current }),
  })
  captureRunning = recovery.checkpointAllowed ? checkpoint.running : noop
  await recovery.guard({ app, checkpoint })

  const emitLifecycle = (frame: LifecycleFrame): void => {
    recovery.consume(frame)
    buffer.pushLifecycle(frame)
    broadcast(frame)
    captureRunning()
    // A settled turn is the durable point where shell spools and cached images are final. Bump
    // only — never broadcast: a signal frame pushed after a lifecycle frame advances the buffer's
    // seq past the lifecycle frame's position, which is what suppresses its replay on reconnect.
    if (frame.kind === EServeFrame.TurnEnded) mirrorRevision.bump()
  }

  const driver = createServeDriver({ app, threadId, workspace, log, idleStop: () => idleStop, emitLifecycle })
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

  const contextReader = createSessionContextReader({ threadId, home: atlasHome })
  const handlers = createSessionHandlers({
    threadId,
    buffer,
    inFlight: () => inFlight(),
    liveStepId: () => liveStepId(),
    driver,
    files: app.files,
    context: contextReader,
    admissionClosed,
    checkpoint: checkpoint.current,
    checkpointChanged: () => captureRunning(),
    refusal: () => workspaceRefusalOf(workspace) ?? null,
    log,
    roster: app.roster,
    prStates: app.prStates,
    rewind: app.rewind,
    compaction: app.compaction,
    agents: app.agents,
    operatorInput: app.operatorInput,
    pending: app.pending,
    sessionMirror: {
      reader: createSessionMirrorReader({
        sessionDir: () => sessionDirectory({ home: atlasHome, sessionId: threadId }),
      }),
      revision: mirrorRevision.current,
    },
    ...handlerOptionsOf({ app, log }),
  })

  const detachSubscriptions = bindServeSubscriptions({
    app,
    buffer,
    handlers,
    contextReader,
    note,
    captureRunning: () => captureRunning(),
    mirror: mirrorRevision,
  })

  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: (frame) => {
      handlers.broadcast(frame)
      if (frame.kind !== EServeFrame.Signal) return
      if (frame.signal.type === 'events-appended') mirrorRevision.bump()
      if (frame.signal.type === 'events-appended' || frame.signal.type === 'step-ended') captureRunning()
    },
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId
  broadcast = handlers.broadcast
  const work = () => {
    const activity = runtimeWork({ app, driver, settling: settling.count, clientsAttached: handlers.clients })
    return { ...activity, settlingWork: activity.settlingWork || handlers.settling() }
  }

  const { resumable } = await announceBoot({ app, threadId, log })
  if (recovery.checkpointAllowed) await checkpoint.boot().catch((failure: unknown) => {
    log({
      event: EServeEvent.CheckpointPersistFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
  })

  await recovery.recover({ session, driver })
  const exit = serveArgs.exit ?? process.exit
  const drain = bindServeDrain({
    app,
    driver,
    threadId,
    atlasHome,
    sandboxSessionId,
    owed: recovery.owed,
    haltIdle: () => idleStop.halt(),
    whenMutationsSettled: async () => { await session.whenStarted(); await handlers.whenSettled() },
    checkpoint,
    close: (given) => lifecycle.close(given),
    exit,
    log,
  })

  boot.complete({
    handlers,
    drain: (given) => recovery.drain({ drain, ...given }).finally(handlers.replayDeferred),
    health: { workspace, clients: handlers.clients, work, nextSeq: () => buffer.nextSeq(), resumable },
  })

  log({ event: EServeEvent.Started, threadId, port, ms: Date.now() - startedAt })

  const lifecycle = createServeLifecycle({
    app,
    driver,
    handlers,
    server,
    bridge,
    threadId,
    checkpoint,
    log,
    work,
    haltIdle: () => idleStop.halt(),
    rearmIdle: () => idleStop.reset(),
    drainDeadlineMs: serveArgs.drainDeadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS,
    detach: () => {
      recovery.detach()
      detachIntake?.()
      unsubscribeWake?.()
      detachSubscriptions()
    },
    stopSandbox: serveArgs.stopSandbox ?? providerStopFor({ threadId, controlPlaneUrl, env, token, clientVersion, fetchFn }),
    exit,
  })

  idleStop = recovery.checkpointAllowed ? startServeIdleStop({
    turnRunning: driver.busy,
    childrenSettling: () => work().settlingWork,
    runningChildren: () => work().childrenRunning,
    runningShells: () => work().shellsRunning,
    runningServices: () => work().servicesRunning,
    pendingInput: () => work().pendingInput,
    clientsAttached: handlers.clients,
    idleMinutes: serveArgs.idleMinutes,
    serviceIdleMinutes: serveArgs.serviceIdleMinutes,
    tickMs: serveArgs.idleTickMs,
    log: (line) => log({ event: EServeEvent.IdleCheckFailed, reason: line }),
    onDue: () => void lifecycle.park(),
  }) : idleStop

  const close = async (shutdown?: { reason: string }): Promise<void> => {
    await lifecycle.close({ reason: shutdown?.reason ?? 'owner-shutdown' })
    await recovery.settled()
  }
  return { port, close }
}
