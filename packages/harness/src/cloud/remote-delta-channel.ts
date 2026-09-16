import type { ThreadId } from '@dltech/atlas-core'

import type { ChannelListener, DeltaChannel, Unsubscribe } from '../channel/delta-channel'
import { EStepEnd, type ChannelSignal, type StepId, type StepSignal } from '../channel/signal'
import {
  bearerSubprotocolOf,
  CHANNEL_SUBPROTOCOL,
  decodeServeFrame,
  EClientFrame,
  type EClientRequest,
  encodeFrame,
  EServeFrame,
  type ServeFrame,
} from './channel-wire'
import {
  sessionSocketUrlOf,
  webSocketFactory,
  type ChannelSocket,
  type ChannelSocketFactory,
} from './remote-channel-socket'
import { createUpstreamPipe, RemotePublishRefused } from './remote-channel-upstream'

export {
  RemotePublishRefused,
  RemoteRequestFailed,
  RemoteRequestLost,
} from './remote-channel-upstream'
export type {
  ChannelSocket,
  ChannelSocketFactory,
  ChannelSocketHandlers,
} from './remote-channel-socket'

export enum EChannelConnection {
  Connecting = 'connecting',
  Open = 'open',
  Reconnecting = 'reconnecting',
  Parked = 'parked',
  Closed = 'closed',
}

export type ChannelConnection = { state: EChannelConnection; detail: string | null }

export type ChannelReload = { sinceEventSeq: number }

export type ChannelFailure = { message: string }

export type RemoteDeltaChannel = DeltaChannel & {
  readonly threadId: ThreadId
  send(args: { text: string }): void
  interrupt(): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  connection(): ChannelConnection
  onConnection(listener: (connection: ChannelConnection) => void): Unsubscribe
  onReload(listener: (reload: ChannelReload) => void): Unsubscribe
  onError(listener: (failure: ChannelFailure) => void): Unsubscribe
  close(): void
}

const RETRY_CEILING_MS = 30_000
const FIRST_RETRY_MS = 500
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

const NOTHING_IN_FLIGHT: readonly StepSignal[] = Object.freeze([])

const defaultBackoffMs = (args: { attempt: number }): number =>
  Math.min(RETRY_CEILING_MS, FIRST_RETRY_MS * 2 ** args.attempt)

const afterDelay = (task: { delayMs: number; run: () => void }) => {
  setTimeout(task.run, task.delayMs)
}

const registryOf = <T>() => {
  const listeners = new Set<(value: T) => void>()
  return {
    add(listener: (value: T) => void): Unsubscribe {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value: T) {
      for (const listener of [...listeners]) listener(value)
    },
  }
}

export function createRemoteDeltaChannel(args: {
  threadId: ThreadId
  url: string
  token: string
  lastEventSeq?: (() => number) | undefined
  socketFactory?: ChannelSocketFactory | undefined
  scheduleRetry?: ((retry: { delayMs: number; run: () => void }) => void) | undefined
  scheduleTimeout?: ((timeout: { delayMs: number; run: () => void }) => void) | undefined
  backoffMs?: ((args: { attempt: number }) => number) | undefined
  maxAttempts?: number | undefined
  requestTimeoutMs?: number | undefined
}): RemoteDeltaChannel {
  const lastEventSeq = args.lastEventSeq ?? (() => 0)
  const socketFactory = args.socketFactory ?? webSocketFactory
  const backoffMs = args.backoffMs ?? defaultBackoffMs
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const scheduleRetry = args.scheduleRetry ?? afterDelay

  const listeners = new Set<ChannelListener>()
  const connections = registryOf<ChannelConnection>()
  const reloads = registryOf<ChannelReload>()
  const failures = registryOf<ChannelFailure>()
  const upstream = createUpstreamPipe({
    timeoutMs: args.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    scheduleTimeout: args.scheduleTimeout ?? afterDelay,
  })

  let inFlight: StepSignal[] = []
  let replay: readonly StepSignal[] | undefined
  let stepId: StepId | undefined
  let channelCursor: number | null = null
  let attempt = 0
  let socket: ChannelSocket | null = null
  let abandoned = false
  let connection: ChannelConnection = { state: EChannelConnection.Connecting, detail: null }

  const write = (data: string): boolean => {
    const live = socket
    if (live === null) return false
    if (live.isOpen !== undefined && !live.isOpen()) return false

    live.send(data)
    return true
  }

  const stableReplay = (): readonly StepSignal[] => {
    if (inFlight.length === 0) return NOTHING_IN_FLIGHT
    replay ??= Object.freeze([...inFlight])
    return replay
  }

  const absorb = (signal: ChannelSignal) => {
    if (signal.type === 'step-started') {
      stepId = signal.stepId
      inFlight = [signal]
      replay = undefined
      return
    }
    if (signal.type === 'step-ended') {
      stepId = undefined
      inFlight = []
      replay = undefined
      return
    }
    if (signal.type !== 'chunk' && signal.type !== 'tool-output') return

    if (signal.type === 'chunk' && signal.stepId !== stepId) {
      stepId = signal.stepId
      inFlight = []
    }

    inFlight.push(signal)
    replay = undefined
  }

  const deliver = (signal: ChannelSignal) => {
    absorb(signal)
    for (const listener of [...listeners]) {
      try {
        listener(signal)
      } catch (error) {
        failures.emit({
          message: `A channel listener threw: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }

  const endStrandedStep = () => {
    if (stepId === undefined) return
    deliver({ type: 'step-ended', stepId, end: EStepEnd.Failed, supersededBy: null })
  }

  const moveTo = (next: ChannelConnection) => {
    connection = next
    connections.emit(next)
  }

  const handleFrame = (frame: ServeFrame) => {
    if (frame.kind === EServeFrame.Ready) {
      attempt = 0
      upstream.attach({ write })
      moveTo({ state: EChannelConnection.Open, detail: null })
      return
    }
    if (frame.kind === EServeFrame.Signal) {
      deliver(frame.signal)
      channelCursor = frame.seq
      return
    }
    if (frame.kind === EServeFrame.Reply) {
      upstream.settleReply({ replyTo: frame.replyTo, ok: frame.ok, data: frame.data })
      return
    }
    if (frame.kind === EServeFrame.Reload) {
      channelCursor = null
      endStrandedStep()
      reloads.emit({ sinceEventSeq: frame.sinceEventSeq })
      return
    }
    if (frame.kind === EServeFrame.Parked) {
      endStrandedStep()
      moveTo({ state: EChannelConnection.Parked, detail: frame.reason })
      return
    }
    if (frame.kind === EServeFrame.Error) failures.emit({ message: frame.message })
  }

  const handleOpen = () => {
    write(
      encodeFrame({
        kind: EClientFrame.Hello,
        threadId: args.threadId,
        channelCursor,
        lastEventSeq: lastEventSeq(),
      }),
    )
  }

  const handleMessage = (data: string) => {
    const frame = decodeServeFrame(data)
    if (frame === null) {
      failures.emit({ message: 'The sandbox sent a frame this client could not read.' })
      return
    }
    handleFrame(frame)
  }

  const handlePing = () => write(encodeFrame({ kind: EClientFrame.Pong }))

  const handleClose = () => {
    socket = null
    upstream.detach({ reason: 'the session socket closed' })
    if (abandoned) return

    if (attempt >= maxAttempts) {
      endStrandedStep()
      moveTo({
        state: EChannelConnection.Closed,
        detail: `The session socket closed and did not reopen after ${maxAttempts} attempts.`,
      })
      return
    }

    const delayMs = backoffMs({ attempt })
    attempt += 1
    moveTo({ state: EChannelConnection.Reconnecting, detail: null })
    scheduleRetry({ delayMs, run: connect })
  }

  const handleError = (message: string) => failures.emit({ message })

  const connect = () => {
    if (abandoned) return
    socket = socketFactory({
      url: sessionSocketUrlOf(args.url),
      protocols: [CHANNEL_SUBPROTOCOL, bearerSubprotocolOf(args.token)],
      handlers: { handleOpen, handleMessage, handlePing, handleClose, handleError },
    })
  }

  connect()

  return {
    threadId: args.threadId,

    subscribe({ threadId, listener }) {
      if (threadId !== args.threadId) return () => undefined

      for (const signal of stableReplay()) listener(signal)
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    snapshot({ threadId }) {
      if (threadId !== args.threadId) return NOTHING_IN_FLIGHT
      return stableReplay()
    },

    publisherFor({ threadId }) {
      throw new RemotePublishRefused(threadId)
    },

    send: ({ text }) => upstream.send({ kind: EClientFrame.Send, text }),

    interrupt: () => upstream.send({ kind: EClientFrame.Interrupt }),

    request: (request) => upstream.request(request),

    connection: () => connection,

    onConnection: (listener) => connections.add(listener),

    onReload: (listener) => reloads.add(listener),

    onError: (listener) => failures.add(listener),

    close() {
      abandoned = true
      endStrandedStep()
      upstream.detach({ reason: 'the channel was closed' })
      socket?.close()
      socket = null
      moveTo({ state: EChannelConnection.Closed, detail: null })
    },
  }
}
