import { STREAM_STALL_MS, type StreamServerMessage } from '@dltech/atlas-protocol'

import type { StreamScheduler, StreamSubscriptionHandlers } from './stream-ports'

export type HandlerHolder = { epoch: number; watchdog: unknown }

export type StreamHandlerArgs = {
  holder: HandlerHolder
  scheduler: StreamScheduler
  clearWatchdog: (holder: HandlerHolder) => void
  onStall: () => void
  onFrame: (frame: StreamServerMessage) => void
  onFailure: (status: number | undefined) => void
  onEnd: () => void
}

export const createStreamHandlers = (args: StreamHandlerArgs): StreamSubscriptionHandlers => {
  const epoch = args.holder.epoch
  const current = (): boolean => epoch === args.holder.epoch
  const watchdog = (): void => {
    if (!current()) return
    args.clearWatchdog(args.holder)
    args.holder.watchdog = args.scheduler.setTimeout(() => {
      if (!current()) return
      args.holder.watchdog = undefined
      args.onStall()
    }, STREAM_STALL_MS)
  }
  watchdog()
  return {
    handleFrame: (frame) => {
      if (!current()) return
      watchdog()
      args.onFrame(frame)
    },
    handleFailure: (status) => {
      if (current()) args.onFailure(status)
    },
    handleEnd: () => {
      if (current()) args.onEnd()
    },
  }
}
