import { createSessionContextReader, EServeFrame, type StepId } from '@dltech/atlas-harness'

import type { ThreadId } from '@dltech/atlas-core'

import { createChannelBridge, type ChannelBridge } from './channel-bridge'
import type { FrameBuffer, SignalFrame } from './frame-buffer'
import { bindServeSubscriptions } from './serve-subscriptions'
import { createBootedSessionHandlers } from './serve-session-handlers'
import type { handlerOptionsOf } from './serve-handler-options'
import type { ServeApp } from './serve-app'
import type { ServeLog } from './serve-log'
import type { SessionHandlers, SessionHandlersArgs } from './socket-session-types'
import type { ServeTurnDriver } from './turn-driver-types'

export type BootedSessionWiring = {
  handlers: SessionHandlers
  detachSubscriptions: () => void
  bridge: ChannelBridge
}

export function bindBootedSession(args: {
  app: ServeApp
  threadId: ThreadId
  atlasHome: string
  workspace: Parameters<typeof createBootedSessionHandlers>[0]['workspace']
  buffer: FrameBuffer
  driver: ServeTurnDriver
  admissionClosed: SessionHandlersArgs['admissionClosed']
  checkpoint: SessionHandlersArgs['checkpoint']
  inFlight: () => readonly SignalFrame[]
  liveStepId: () => StepId | null
  log: ServeLog
  options: ReturnType<typeof handlerOptionsOf>
  note: () => void
  captureRunning: () => void
}): BootedSessionWiring {
  const { app, threadId, atlasHome, buffer, driver, log } = args
  const contextReader = createSessionContextReader({ threadId, home: atlasHome })
  const handlers = createBootedSessionHandlers({
    app,
    threadId,
    atlasHome,
    workspace: args.workspace,
    buffer,
    driver,
    contextReader,
    admissionClosed: args.admissionClosed,
    checkpoint: args.checkpoint,
    checkpointChanged: () => args.captureRunning(),
    inFlight: args.inFlight,
    liveStepId: args.liveStepId,
    log,
    options: args.options,
  })
  const detachSubscriptions = bindServeSubscriptions({
    app,
    threadId,
    buffer,
    handlers,
    contextReader,
    note: args.note,
    captureRunning: args.captureRunning,
  })
  const bridge = createChannelBridge({
    channel: app.channel,
    threadId,
    buffer,
    onFrame: (frame) => {
      handlers.broadcast(frame)
      if (frame.kind !== EServeFrame.Signal) return
      if (frame.signal.type === 'events-appended' || frame.signal.type === 'step-ended')
        args.captureRunning()
    },
  })
  return { handlers, detachSubscriptions, bridge }
}
