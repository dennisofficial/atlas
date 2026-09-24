import { toThreadId } from '@dltech/atlas-core'

import { toStepId, type ChannelSignal } from '../../channel/signal'
import {
  decodeClientFrame,
  encodeFrame,
  EServeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../channel-wire'
import { createRemoteDeltaChannel } from '../remote-delta-channel'
import type { ChannelSocketHandlers } from '../remote-channel-socket'

export const THREAD = toThreadId('brn_cloud')
export const OTHER_THREAD = toThreadId('brn_local')
export const STEP = toStepId('brn_cloud#1')

export type FakeSocket = {
  url: string
  protocols: readonly string[]
  handlers: ChannelSocketHandlers
  sent: ClientFrame[]
  closed: boolean
}

export const chunkSignal = (text: string): ChannelSignal => ({
  type: 'chunk',
  stepId: STEP,
  chunk: { type: 'text-delta', id: 't1', text },
})

export const started: ChannelSignal = { type: 'step-started', stepId: STEP }

export const recorder = () => {
  const seen: ChannelSignal[] = []
  return { seen, listener: (signal: ChannelSignal) => void seen.push(signal) }
}

export const harness = (options?: {
  lastEventSeq?: number | undefined
  maxAttempts?: number | undefined
  maxReattachments?: number | undefined
  reattach?: (() => Promise<{ url: string; token: string }>) | undefined
  requestTimeoutMs?: number | undefined
  interruptAckTimeoutMs?: number | undefined
}) => {
  const sockets: FakeSocket[] = []
  const retries: { delayMs: number; run: () => void }[] = []
  const timeouts: { delayMs: number; run: () => void }[] = []

  const channel = createRemoteDeltaChannel({
    threadId: THREAD,
    url: 'https://sandbox.test/',
    token: 'tok_session',
    lastEventSeq: () => options?.lastEventSeq ?? 0,
    maxAttempts: options?.maxAttempts,
    maxReattachments: options?.maxReattachments,
    reattach: options?.reattach,
    requestTimeoutMs: options?.requestTimeoutMs,
    interruptAckTimeoutMs: options?.interruptAckTimeoutMs,
    scheduleRetry: (retry) => void retries.push(retry),
    scheduleTimeout: (timeout) => void timeouts.push(timeout),
    socketFactory: ({ url, protocols, handlers }) => {
      const fake: FakeSocket = { url, protocols, handlers, sent: [], closed: false }
      sockets.push(fake)
      return {
        send: (data) => {
          const frame = decodeClientFrame(data)
          if (frame === null) throw new Error(`unreadable client frame: ${data}`)
          fake.sent.push(frame)
        },
        close: () => void (fake.closed = true),
      }
    },
  })

  const live = (): FakeSocket => {
    const socket = sockets.at(-1)
    if (socket === undefined) throw new Error('no socket was opened')
    return socket
  }

  return {
    channel,
    sockets,
    retries,
    timeouts,
    live,
    open: () => live().handlers.handleOpen(),
    ping: () => live().handlers.handlePing(),
    receive: (frame: ServeFrame) => live().handlers.handleMessage(encodeFrame(frame)),
    drop: () => live().handlers.handleClose(),
  }
}

export const readied = (options?: Parameters<typeof harness>[0]) => {
  const attached = harness(options)
  attached.open()
  attached.receive({ kind: EServeFrame.Ready, seq: 1 })
  return attached
}
