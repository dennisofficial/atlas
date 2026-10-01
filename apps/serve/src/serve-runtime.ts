import { isResumable, type ThreadId } from '@dltech/atlas-core'

import type { StepId } from '@dltech/atlas-harness'
import { EServeFrame, type ServeFrame, type TurnOutcomeWire } from '@dltech/atlas-harness'
import { MainWake as LegacyWake } from '@dltech/atlas-harness'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'

import { syncCapabilitiesNotice } from './capabilities-notice'
import { createChannelBridge } from './channel-bridge'
import { DEFAULT_DRAIN_DEADLINE_MS } from './drain-deadline'
import { createFrameBuffer, DEFAULT_FRAME_BUFFER, type LifecycleFrame, type SignalFrame } from './frame-buffer'
import { startServeIdleStop } from './idle-stop'
import { runtimeWork } from './runtime-work'
import { sandboxPark } from './sandbox-park'
import { createRuntimeCheckpointCapture } from './runtime-checkpoint'
import { bindRuntimeCheckpoint } from './runtime-checkpoint-binding'
import { createServeLifecycle } from './serve-lifecycle'
import { hydrateCloudPlacement } from './placement-hydration'
import { restoreTranscript } from './restore-transcript'
import { transcriptBootstrapReceipt } from './transcript-bootstrap'
import { EWorkspaceState, workspaceRefusalOf } from './materialize-workspace'
import { workspacePublisherFor, type WorkspacePublisher } from './publish-workspace'
import { EServeEvent } from './serve-log'
import { startSessionServer } from './session-server'
import { createSessionHandlers } from './socket-session'
import { createTurnDriver } from './turn-driver'
import { adoptChildrenInBackground, settleLostShellsInBackground } from './startup-recovery'
import { driveTranscriptArchiveFetcher, driveWorkspaceSpecFetcher } from './drive-bootstrap'
import type { FetchTranscriptArchive } from './workspace-spec'
import type { ServeBootstrap } from './serve-bootstrap'

export type ServeHandle = {
  port: number
  close: (args?: { reason: string }) => Promise<void>
}

const wireOutcomeOf = (outcome: TurnOutcome): TurnOutcomeWire => {
  if (outcome.status !== ETurnStatus.Failed) return outcome
  return { status: outcome.status, runId: outcome.runId, message: outcome.message }
}

export async function runServeRuntime(args: {
  bootstrap: ServeBootstrap
  stopSandbox?: (() => Promise<void>) | undefined
  exit?: ((code: number) => void) | undefined
  bufferSize?: number | undefined
  drainDeadlineMs?: number | undefined
  idleMinutes?: number | undefined
  idleTickMs?: number | undefined
  publishWorkspace?: WorkspacePublisher | undefined
  fetchTranscriptArchive?: FetchTranscriptArchive | undefined
}): Promise<ServeHandle> {
  const { bootstrap } = args
  const { threadId, wanted, controlPlaneUrl, cwd, env, startedAt, log, driveHome, workspace, app, capabilities } =
    bootstrap

  const buffer = createFrameBuffer({ capacity: args.bufferSize ?? DEFAULT_FRAME_BUFFER })

  const settling = { count: 0 }
  const noop = (): void => undefined
  let idleStop: { note: () => void; halt: () => void; reset: () => void } = { note: noop, halt: noop, reset: noop }
  const admission = { closed: false }
  let captureRunning = (): void => undefined

  const note = () => idleStop.note()
  adoptChildrenInBackground({ app, threadId, log, settling, note })
  settleLostShellsInBackground({ app, threadId, log, settling, note })

  let inFlight: () => readonly SignalFrame[] = () => []
  let liveStepId: () => StepId | null = () => null
  let broadcast: (frame: ServeFrame) => void = () => undefined

  const emitLifecycle = (frame: LifecycleFrame): void => {
    buffer.pushLifecycle(frame)
    broadcast(frame)
    captureRunning()
  }

  const driver = createTurnDriver({
    app,
    threadId,
    refusal: () => admission.closed ? 'this sandbox is parking and accepts no new work' : workspaceRefusalOf(workspace),
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

  const detachIntake = app.intake === undefined ? undefined : driver.attach(app.intake)
  const wake =
    app.intake !== undefined || app.wakeNotices === undefined
      ? undefined
      : new LegacyWake({
          blocked: () => driver.running(),
          onWake: () => {
            idleStop.note()
            driver.sayOrRun()
          },
        })
  const unsubscribeWake =
    app.intake !== undefined
      ? undefined
      : app.wakeNotices?.subscribe(() => {
          if (app.wakeNotices === undefined) return
          const waiting =
            app.wakeNotices.pendingShells({ threadId }) +
            app.wakeNotices.pendingAgents({ threadId }) +
            app.wakeNotices.pendingServices({ threadId })
          wake?.onNotice({ witness: waiting > 0 ? `pending:${waiting}` : null })
        })

  const publishWorkspace: WorkspacePublisher =
    args.publishWorkspace ??
    workspacePublisherFor({
      workspace,
      threadId,
      fetchSpec: driveWorkspaceSpecFetcher({ driveHome }),
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
    admissionClosed: () => admission.closed,
    checkpoint: () => checkpoint.current(),
    checkpointChanged: () => captureRunning(),
    refusal: () => workspaceRefusalOf(workspace) ?? null,
    log,
    roster: app.roster,
    rewind: app.rewind,
    ...(app.ledger === undefined ? {} : { transcript: { log: app.log, threads: app.threads, ledger: app.ledger } }),
    ...(app.modelBridge === undefined ? {} : { selectModel: app.modelBridge.select }),
    ...(app.sessionArchive === undefined ? {} : { sessionArchive: app.sessionArchive }),
    ...(app.memoryArchive === undefined ? {} : { memoryArchive: app.memoryArchive }),
    restoreTranscript: async (marker) => {
      const fetchArchive = args.fetchTranscriptArchive ?? driveTranscriptArchiveFetcher({ driveHome })
      const receiptBefore = await transcriptBootstrapReceipt({ atlasHome: driveHome })
      const result = await restoreTranscript({
        fetchArchive,
        atlasHome: driveHome,
        threadId,
        log: app.log,
        ids: app.ids,
        ...(marker === undefined ? {} : { marker }),
        refuseIfBusy: () =>
          settling.count > 0
            ? 'transferred children are still resuming, so the transcript cannot be replaced'
            : null,
      })
      if (result.failed !== null) log({ event: EServeEvent.TranscriptFailed, reason: result.failed })
      else if (result.restored) log({ event: EServeEvent.TranscriptRestored })
      if (!result.restored) return result
      await hydrateCloudPlacement({ app, threadId })
      const receiptAfter = await transcriptBootstrapReceipt({ atlasHome: driveHome })
      if (receiptAfter !== receiptBefore || receiptAfter === null) {
        const restoredThread = await app.threads.find({ threadId })
        if (app.modelBridge !== undefined && restoredThread?.model !== undefined) {
          app.modelBridge.select({
            ref: restoredThread.model.ref,
            effort: restoredThread.model.effort ?? app.modelBridge.effort(),
          })
        }
        adoptChildrenInBackground({ app, threadId, log, settling, note })
      }
      return result
    },
  })

  const unsubscribeThreads = (() => {
    const onRename = app.threads.onRename?.bind(app.threads)
    const onModelChosen = app.threads.onModelChosen?.bind(app.threads)
    if (onRename === undefined || onModelChosen === undefined) return undefined
    const offs = [
      onRename(({ threadId: renamed, title }) => handlers.broadcast({ kind: EServeFrame.ThreadRenamed, threadId: renamed, title })),
      onModelChosen(({ threadId: chosen, model }) => handlers.broadcast({ kind: EServeFrame.ThreadModelChanged, threadId: chosen, model })),
    ]
    return () => { for (const off of offs) off() }
  })()

  const unsubscribeRoster = app.roster?.subscribe(() => {
    idleStop.note()
    captureRunning()
    handlers.broadcastRoster()
  })
  const unsubscribePending = app.pending?.subscribe(() => idleStop.note())

  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: (frame) => {
      handlers.broadcast(frame)
      if (frame.kind === EServeFrame.Signal && (frame.signal.type === 'events-appended' || frame.signal.type === 'step-ended')) captureRunning()
    },
  })
  inFlight = bridge.inFlight
  liveStepId = bridge.liveStepId
  broadcast = handlers.broadcast
  const work = () => {
    const activity = runtimeWork({ app, driver, settling: settling.count })
    return { ...activity, settlingWork: activity.settlingWork || handlers.settling() }
  }
  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({ threadId, atlasHome: driveHome, env, token: bootstrap.token, transcript: app.log, log, fetchFn: bootstrap.fetchFn }),
    log,
    publish: (current) => handlers.broadcast({ kind: EServeFrame.Checkpoint, checkpoint: current }),
  })
  captureRunning = checkpoint.running

  const events = await app.log.read({ threadId }).catch(() => [])
  if (capabilities !== undefined) {
    await syncCapabilitiesNotice({
      log: app.log,
      threadId,
      runId: app.ids.nextRunId(),
      events,
      capabilities,
    }).catch(() => false)
  }
  await checkpoint.boot().catch((failure: unknown) => {
    log({ event: EServeEvent.CheckpointPersistFailed, reason: failure instanceof Error ? failure.message : String(failure) })
  })
  captureRunning()
  const resumable = isResumable(events)
  if (resumable) log({ event: EServeEvent.Resumable, head: events.at(-1)?.seq ?? 0 })

  const server = startSessionServer({
    port: wanted,
    token: bootstrap.token,
    handlers,
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
    app, driver, handlers, server, bridge, threadId, admission, log,
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
    exit: args.exit ?? process.exit,
    finalizePark: checkpoint.finalizePark,
  })

  idleStop = startServeIdleStop({
    turnRunning: () => driver.busy(),
    childrenSettling: () => work().settlingWork,
    runningChildren: () => work().childrenRunning,
    runningShells: () => work().shellsRunning,
    runningServices: () => work().servicesRunning,
    pendingInput: () => work().pendingInput,
    idleMinutes: args.idleMinutes,
    tickMs: args.idleTickMs,
    log: (line) => log({ event: EServeEvent.IdleCheckFailed, reason: line }),
    onDue: () => { void lifecycle.park() },
  })

  return { port, close: (shutdown) => lifecycle.close({ reason: shutdown?.reason ?? 'owner-shutdown' }) }
}
