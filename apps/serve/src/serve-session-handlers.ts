import type { StepId } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'
import type { createSessionContextReader } from '@dltech/atlas-harness'

import { admitsFamilyThread } from './family-admission'
import type { FrameBuffer, SignalFrame } from './frame-buffer'
import { workspaceRefusalOf, type WorkspaceReadiness } from './materialize-workspace'
import type { ServeApp } from './serve-app'
import type { handlerOptionsOf } from './serve-handler-options'
import type { ServeLog } from './serve-log'
import {
  createSessionHandlers,
  type SessionHandlers,
  type SessionHandlersArgs,
} from './socket-session'
import type { ServeTurnDriver } from './turn-driver'

type ContextReader = ReturnType<typeof createSessionContextReader>

/** The websocket handlers of the session channel, composed over the booted app. */
export function createBootedSessionHandlers(args: {
  app: ServeApp
  threadId: ThreadId
  atlasHome: string
  workspace: WorkspaceReadiness
  buffer: FrameBuffer
  driver: ServeTurnDriver
  contextReader: ContextReader
  admissionClosed: SessionHandlersArgs['admissionClosed']
  checkpoint: SessionHandlersArgs['checkpoint']
  checkpointChanged: SessionHandlersArgs['checkpointChanged']
  inFlight: () => readonly SignalFrame[]
  liveStepId: () => StepId | null
  log: ServeLog
  options: ReturnType<typeof handlerOptionsOf>
}): SessionHandlers {
  const { app, threadId, atlasHome, workspace, buffer, driver, contextReader, log } = args
  return createSessionHandlers({
    activity: app.activity,
    threadId,
    admitsThread: admitsFamilyThread({ root: threadId, atlasHome }),
    ...(app.agents === undefined
      ? {}
      : {
          childSend: {
            agents: app.agents,
            runner: app.runner,
            log: app.log,
            ids: app.ids,
          },
        }),
    buffer,
    inFlight: args.inFlight,
    liveStepId: args.liveStepId,
    driver,
    files: app.files,
    context: contextReader,
    admissionClosed: args.admissionClosed,
    checkpoint: args.checkpoint,
    checkpointChanged: args.checkpointChanged,
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
    ...args.options,
  })
}
