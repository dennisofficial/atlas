import { randomUUID } from 'node:crypto'

import {
  EPodCallKind,
  POD_STREAM_RENEW_EVERY_MS,
  POD_STREAM_TTL_MS,
  type PodCallRequest,
  type PodStreamFrame,
} from '@dltech/atlas-protocol'

import type { EventFrame } from '../../calls/remote-calls'
import type { HostTimers } from '../ports'
import type { PodCallBus } from '../pod-call-port'
import type { PodFollowClose } from './pod-reach'

export type PodFollowArgs = {
  bus: PodCallBus
  timers: HostTimers
  sessionId: string
  hostId: number
  listener: (frame: EventFrame) => void
  onClose?: ((reason: PodFollowClose) => void) | undefined
  signal?: AbortSignal | undefined
  timeoutMs: number
}

type PodStreamAddress = {
  requestId: string
  replyTo: string
  sessionId: string
  targetHostId: number
  streamId: string
}

export const followRemotePod = async (args: PodFollowArgs): Promise<(() => void) | null> => {
  const streamId = randomUUID()
  const addressed = (): PodStreamAddress => ({
    requestId: randomUUID(),
    replyTo: args.bus.requesterId,
    sessionId: args.sessionId,
    targetHostId: args.hostId,
    streamId,
  })
  const followRequest = (): PodCallRequest => ({
    kind: EPodCallKind.Follow,
    ...addressed(),
    ttlMs: POD_STREAM_TTL_MS,
  })
  const renewRequest = (): PodCallRequest => ({
    kind: EPodCallKind.Renew,
    ...addressed(),
    ttlMs: POD_STREAM_TTL_MS,
  })
  const releaseRequest = (): PodCallRequest => ({
    kind: EPodCallKind.Release,
    ...addressed(),
  })

  let disposed = false
  let followSent = false
  let renewTimer: unknown
  let unsubscribe: (() => Promise<void>) | undefined
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    args.timers.clearTimeout(renewTimer)
    args.signal?.removeEventListener('abort', dispose)
    void unsubscribe?.()
    if (!followSent) return
    void args.bus
      .request({ request: releaseRequest(), timeoutMs: args.timeoutMs })
      .catch(() => undefined)
  }

  if (args.signal?.aborted === true) return null
  args.signal?.addEventListener('abort', dispose)

  const offFrames = await args.bus.subscribeFrames({
    streamId,
    listener: (frame: PodStreamFrame) => {
      if (disposed) return
      if (frame.type === 'event') {
        args.listener(frame.frame)
        return
      }
      args.onClose?.(frame.reason)
      dispose()
    },
  })
  unsubscribe = offFrames
  if (disposed) {
    await offFrames()
    return null
  }

  followSent = true
  const opened = await args.bus
    .request({ request: followRequest(), timeoutMs: args.timeoutMs })
    .catch(() => undefined)
  if (opened?.state !== 'open' || disposed) {
    dispose()
    return null
  }

  const renew = async (): Promise<void> => {
    if (disposed) return
    const reply = await args.bus
      .request({ request: renewRequest(), timeoutMs: args.timeoutMs })
      .catch(() => undefined)
    if (disposed) return
    if (reply?.state !== 'open') {
      args.onClose?.('restarted')
      dispose()
      return
    }
    renewTimer = args.timers.setTimeout(() => void renew(), POD_STREAM_RENEW_EVERY_MS)
  }
  renewTimer = args.timers.setTimeout(() => void renew(), POD_STREAM_RENEW_EVERY_MS)

  return dispose
}
