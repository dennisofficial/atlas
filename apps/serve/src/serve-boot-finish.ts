import {
  EServeFrame,
  createSessionContextReader,
  type ServeFrame,
  type StepId,
} from '@dltech/atlas-harness'
import { admissionClosedFor } from '@dltech/atlas-wire'

import type { ThreadId } from '@dltech/atlas-core'

import { createChannelBridge } from './channel-bridge'
import { DEFAULT_DRAIN_DEADLINE_MS } from './drain-deadline'
import {
  createFrameBuffer,
  DEFAULT_FRAME_BUFFER,
  type LifecycleFrame,
  type SignalFrame,
} from './frame-buffer'
import { workspaceRefusalOf } from './materialize-workspace'
import { createRuntimeCheckpointCapture } from './runtime-checkpoint'
import { bindRuntimeCheckpoint } from './runtime-checkpoint-binding'
import { runtimeWork } from './runtime-work'
import { providerStopFor } from './sandbox-park'
import type { ServeArgs, ServeHandle } from './serve-args'
import { announceBoot } from './serve-announce'
import { bootServeApp } from './serve-boot-app'
import { bindServeActivity } from './serve-activity-binding'
import { bindServeIdleStop, noopIdle } from './serve-idle-binding'
import type { BootListener } from './serve-boot-listener'
import { bindSessionDrain } from './serve-drain-binding'
import { resumeWhenRegistered } from './serve-resume-boot'
import { createServeLifecycle } from './serve-lifecycle'
import { createServeDriver } from './serve-driver'
import { handlerOptionsOf } from './serve-handler-options'
import { EServeEvent, type LoggingNoticePort, type ServeLog } from './serve-log'
import { bindServeSubscriptions } from './serve-subscriptions'
import { subscribeLegacyWake } from './serve-wake'
import { createSessionHandlers } from './socket-session'
import { createServeWorkspaceSession } from './serve-workspace-session'

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
  const { serveArgs, env, threadId, token, controlPlaneUrl, startedAt, log } = args
  const { atlasHome, sandboxSessionId, boot } = args
  const { server, port } = boot
  const {
    app,
    recovery,
    workspace,
    fetchFn,
    writeBehind,
    contextMirror,
    clientVersion,
    refreshCloudState,
  } = await bootServeApp(args)

  const admissionClosed = (): boolean => {
    if (recovery.admissionLatched) return true
    const current = checkpoint.current()
    return current !== null && admissionClosedFor(current.phase)
  }

  refreshCloudState.bindSettings(app.settings)

  const buffer = createFrameBuffer({ capacity: serveArgs.bufferSize ?? DEFAULT_FRAME_BUFFER })
  const settling = { count: 0 },
    noop = (): void => undefined
  let idleStop: { note: () => void; halt: () => void; reset: () => void } = noopIdle(noop)
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

  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({
      threadId,
      atlasHome,
      env,
      token,
      clientVersion,
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
  }
  const remote = { controlPlaneUrl, token, clientVersion, fetchFn }
  const activity = bindServeActivity({ env, app, threadId, remote, log })
  const driver = createServeDriver({
    activity: activity.tracker,
    app,
    threadId,
    workspace,
    log,
    idleStop: () => idleStop,
    emitLifecycle,
    beforeTurn: async () => {
      await refreshCloudState.refresh()
      await app.mcp?.refresh()
    },
  })
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
    activity: app.activity,
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
    titling: app.titling,
    prStates: app.prStates,
    subscriptions: app.subscriptions,
    commands: app.commands,
    mcp: app.mcp,
    rewind: app.rewind,
    compaction: app.compaction,
    agents: app.agents,
    processes: app.processes,
    operatorInput: app.operatorInput,
    pending: app.pending,
    tools: { changes: app.changes, terminal: app.terminal },
    ...handlerOptionsOf({ app, log, persist: { ...args, clientVersion, fetchFn } }),
  })
  const detachSubscriptions = bindServeSubscriptions({
    app,
    threadId,
    buffer,
    handlers,
    contextReader,
    note,
    captureRunning: () => captureRunning(),
  })
  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: (frame) => {
      handlers.broadcast(frame)
      if (frame.kind !== EServeFrame.Signal) return
      if (frame.signal.type === 'events-appended' || frame.signal.type === 'step-ended')
        captureRunning()
    },
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId
  broadcast = handlers.broadcast
  const work = () => {
    const activity = runtimeWork({
      app,
      driver,
      settling: settling.count,
      clientsAttached: handlers.clients,
    })
    return { ...activity, settlingWork: activity.settlingWork || handlers.settling() }
  }

  const { resumable } = await announceBoot({ app, threadId, log })
  if (recovery.checkpointAllowed)
    await checkpoint.boot().catch((failure: unknown) => {
      log({
        event: EServeEvent.CheckpointPersistFailed,
        reason: failure instanceof Error ? failure.message : String(failure),
      })
    })

  await recovery.recover({ session, driver })
  resumeWhenRegistered({
    env,
    resumable,
    admissionLatched: admissionClosed(),
    driver,
    app,
    threadId,
    log,
  })
  const exit = serveArgs.exit ?? process.exit
  const { drainSession, rollover } = bindSessionDrain({
    recovery,
    handlers,
    session,
    idle: () => idleStop,
    drain: { app, driver, threadId, atlasHome, sandboxSessionId, owed: recovery.owed, checkpoint },
    close: (given) => lifecycle.close(given),
    exit,
    log,
  })

  boot.complete({
    handlers,
    drain: drainSession,
    health: {
      workspace,
      clients: handlers.clients,
      work,
      nextSeq: () => buffer.nextSeq(),
      resumable,
    },
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
      writeBehind?.detach()
      contextMirror?.detach()
      activity.detach()
    },
    stopSandbox:
      serveArgs.stopSandbox ??
      providerStopFor({ threadId, controlPlaneUrl, env, token, clientVersion, fetchFn }),
    flushEvents: async () => {
      const events = (await writeBehind?.flush()) ?? true
      const context = (await contextMirror?.flush()) ?? true
      return events && context
    },
    reportParked: activity.reportParked,
    exit,
  })

  idleStop = recovery.checkpointAllowed
    ? bindServeIdleStop({
        serveArgs,
        deadline: { env, threadId, remote, rollover },
        turnRunning: driver.busy,
        work,
        clientsAttached: handlers.clients,
        log,
        onDue: () => void lifecycle.park(),
      })
    : idleStop

  const close = async (shutdown?: { reason: string }): Promise<void> => {
    await lifecycle.close({ reason: shutdown?.reason ?? 'owner-shutdown' })
    await recovery.settled()
  }
  return { port, close }
}
