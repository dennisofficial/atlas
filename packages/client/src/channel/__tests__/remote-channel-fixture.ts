import { toThreadId } from '@dltech/atlas-core'
import {
  ERuntimePhase,
  runtimeCheckpointSchema,
  type RuntimeCheckpoint,
} from '@dltech/atlas-wire/web'

import { toStepId, type ChannelSignal } from '../signal'
import {
  decodeClientFrame,
  encodeFrame,
  EServeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../channel-wire'
import { createRemoteDeltaChannel, type SandboxWake } from '../remote-delta-channel'
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
  /** A deferred durable-head read, for the Promise path the production store drives. */
  lastEventSeqAsync?: (() => Promise<number>) | undefined
  maxAttempts?: number | undefined
  wakeSandbox?: SandboxWake | undefined
  requestTimeoutMs?: number | undefined
  unwrittenRequestTimeoutMs?: number | undefined
  interruptAckTimeoutMs?: number | undefined
  unattached?: boolean | undefined
  readsWake?: boolean | undefined
}) => {
  const sockets: FakeSocket[] = []
  const retries: { delayMs: number; run: () => void }[] = []
  const timeouts: { delayMs: number; run: () => void }[] = []

  const channel = createRemoteDeltaChannel({
    threadId: THREAD,
    ...(options?.unattached === true ? {} : { url: 'https://sandbox.test/', token: 'tok_session' }),
    lastEventSeq: options?.lastEventSeqAsync ?? (() => options?.lastEventSeq ?? 0),
    maxAttempts: options?.maxAttempts,
    wakeSandbox: options?.wakeSandbox,
    readsWake: options?.readsWake,
    requestTimeoutMs: options?.requestTimeoutMs,
    unwrittenRequestTimeoutMs: options?.unwrittenRequestTimeoutMs,
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

export const checkpointOf = (args: {
  phase: ERuntimePhase
  revision: number
  threadId?: string | undefined
}): RuntimeCheckpoint => {
  const base = {
    threadId: args.threadId ?? THREAD,
    runtimeId: 'runtime-1',
    sandboxSessionId: 'session-1',
    revision: args.revision,
    reportedAt: '2026-10-16T00:00:00.000Z',
    transcript: { head: 0, count: 0, digest: '0'.repeat(64) },
    phase: args.phase,
  }
  if (args.phase !== ERuntimePhase.Updating) return runtimeCheckpointSchema.parse(base)
  return runtimeCheckpointSchema.parse({
    ...base,
    receipt: {
      version: 1,
      threadId: base.threadId,
      sandboxSessionId: base.sandboxSessionId,
      resumeParent: false,
      checkpoint: base,
    },
  })
}

export const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined
  let reject: (failure: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
