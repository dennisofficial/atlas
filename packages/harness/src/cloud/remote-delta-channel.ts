import type { EventDraft, SaidImage, ThreadId } from '@dltech/atlas-core'

import type { ChannelListener, DeltaChannel, Unsubscribe } from '../channel/delta-channel'
import { retainReplayable, type InFlightSlots } from '../channel/in-flight'
import { EStepEnd, type ChannelSignal, type StepId, type StepSignal } from '../channel/signal'
import type { TurnOutcome } from '../loop/turn-outcome'
import type { RosterWire } from '@dltech/atlas-core'

import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  decodeServeFrame,
  EClientFrame,
  type EClientRequest,
  encodeFrame,
  EServeFrame,
  turnOutcomeFromWire,
  type ServeFrame,
} from './channel-wire'
import {
  sessionSocketUrlOf,
  webSocketFactory,
  type ChannelSocket,
  type ChannelSocketFactory,
} from './remote-channel-socket'
import { createUpstreamPipe, RemotePublishRefused } from './remote-channel-upstream'
import {
  DEFAULT_KEEPALIVE_MS,
  intervalKeepaliveScheduler,
  type ScheduleKeepalive,
} from './keepalive'

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
  Reattaching = 'reattaching',
  Parked = 'parked',
  Closed = 'closed',
}

export type ChannelConnection = { state: EChannelConnection; detail: string | null }

export type ChannelReload = { sinceEventSeq: number }

export type ChannelFailure = { message: string }

/** What the serve said about itself at greet — whether the turn it was running survived. */
export type ChannelReady = { turnInFlight: boolean }

/** The far side received the interrupt frame and aborted the turn it was driving. */
export type InterruptAck = { turnInFlight: boolean }

export const INTERRUPT_ACK_TIMEOUT_MS = 5_000

export type RemoteDeltaChannel = DeltaChannel & {
  readonly threadId: ThreadId
  send(args: { text: string; images?: readonly SaidImage[]; context?: readonly EventDraft[] }): void
  run(): void
  interrupt(): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  connection(): ChannelConnection
  onConnection(listener: (connection: ChannelConnection) => void): Unsubscribe
  onReload(listener: (reload: ChannelReload) => void): Unsubscribe
  onReady(listener: (ready: ChannelReady) => void): Unsubscribe
  onInterruptAck(listener: (ack: InterruptAck) => void): Unsubscribe
  onRoster(listener: (roster: RosterWire) => void): Unsubscribe
  onTurnEnded(listener: (outcome: TurnOutcome) => void): Unsubscribe
  onError(listener: (failure: ChannelFailure) => void): Unsubscribe
  onServerError(listener: (failure: ChannelFailure) => void): Unsubscribe
  wake(args: { url: string; token: string }): void
  close(): void
}

const RETRY_CEILING_MS = 30_000
const FIRST_RETRY_MS = 500
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_MAX_REATTACHMENTS = 3
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
  scheduleKeepalive?: ScheduleKeepalive | undefined
  backoffMs?: ((args: { attempt: number }) => number) | undefined
  maxAttempts?: number | undefined
  requestTimeoutMs?: number | undefined
  keepaliveMs?: number | undefined
  interruptAckTimeoutMs?: number | undefined
  /**
   * Once the socket retries are spent, re-attach through the API. The relaunched serve keeps
   * whatever turn was already running — a re-attach loses the client's own in-flight step (it has
   * no durable replay), not the turn on the far side, which the reported `Ready.turnInFlight`
   * settles for the caller.
   */
  reattach?: (() => Promise<{ url: string; token: string }>) | undefined
  maxReattachments?: number | undefined
  /**
   * A dead sandbox fails a WS connect in ~150ms and a parked one never answers, so waiting out
   * the full backoff (~91.5s) before `reattach` is pure waste. Called once per retry cycle; a
   * settled `true` escalates immediately instead of waiting out the rest of the backoff.
   */
  shouldEscalate?: (() => Promise<boolean>) | undefined
}): RemoteDeltaChannel {
  const lastEventSeq = args.lastEventSeq ?? (() => 0)
  const socketFactory = args.socketFactory ?? webSocketFactory
  const backoffMs = args.backoffMs ?? defaultBackoffMs
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const maxReattachments = args.maxReattachments ?? DEFAULT_MAX_REATTACHMENTS
  const scheduleRetry = args.scheduleRetry ?? afterDelay
  const keepaliveMs = args.keepaliveMs ?? DEFAULT_KEEPALIVE_MS
  const scheduleKeepalive = args.scheduleKeepalive ?? intervalKeepaliveScheduler
  const interruptAckTimeoutMs = args.interruptAckTimeoutMs ?? INTERRUPT_ACK_TIMEOUT_MS
  const scheduleTimeout = args.scheduleTimeout ?? afterDelay

  const listeners = new Set<ChannelListener>()
  const interruptAcks = registryOf<InterruptAck>()
  const connections = registryOf<ChannelConnection>()
  const reloads = registryOf<ChannelReload>()
  const readies = registryOf<ChannelReady>()
  const rosters = registryOf<RosterWire>()
  const turnEndings = registryOf<TurnOutcome>()
  const failures = registryOf<ChannelFailure>()
  const serverErrors = registryOf<ChannelFailure>()
  const upstream = createUpstreamPipe({
    timeoutMs: args.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    scheduleTimeout,
  })

  let inFlight: StepSignal[] = []
  const toolOutputSlots: InFlightSlots = new Map()
  let replay: readonly StepSignal[] | undefined
  let stepId: StepId | undefined
  let channelCursor: number | null = null
  let attempt = 0
  let reattachments = 0
  let socket: ChannelSocket | null = null
  let stopKeepalive: (() => void) | null = null
  let abandoned = false
  let generation = 0
  let url = args.url
  let token = args.token
  let connection: ChannelConnection = { state: EChannelConnection.Connecting, detail: null }
  let interruptPending = false
  let interruptSentGeneration = -1

  /**
   * The interrupt frame is fire-and-forget over a socket that can be half-open, so the stamp
   * survives what the frame may not: the ack bounds it over a live socket, and a Ready arriving
   * while it stands means the frame was lost to the last connection — re-sent there and then.
   */
  const requestInterrupt = () => {
    interruptPending = true
    interruptSentGeneration = generation
    upstream.send({ kind: EClientFrame.Interrupt })
    const sentGeneration = generation
    scheduleTimeout({
      delayMs: interruptAckTimeoutMs,
      run: () => {
        if (!interruptPending || interruptSentGeneration !== sentGeneration) return
        if (connection.state !== EChannelConnection.Open) return
        failures.emit({ message: 'The sandbox never acknowledged the interrupt.' })
      },
    })
  }

  const write = (data: string): boolean => {
    const live = socket
    if (live === null) return false
    if (live.isOpen !== undefined && !live.isOpen()) return false

    live.send(data)
    return true
  }

  const clearKeepalive = () => {
    stopKeepalive?.()
    stopKeepalive = null
  }

  const startKeepalive = () => {
    clearKeepalive()
    stopKeepalive = scheduleKeepalive({
      intervalMs: keepaliveMs,
      run: () => write(encodeFrame({ kind: EClientFrame.Pong })),
    })
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
      toolOutputSlots.clear()
      replay = undefined
      return
    }
    if (signal.type === 'step-ended') {
      stepId = undefined
      inFlight = []
      toolOutputSlots.clear()
      replay = undefined
      return
    }
    if (signal.type !== 'chunk' && signal.type !== 'tool-output') return

    if (signal.type === 'chunk' && signal.stepId !== stepId) {
      stepId = signal.stepId
      inFlight = []
      toolOutputSlots.clear()
    }

    retainReplayable({ inFlight, slots: toolOutputSlots, signal })
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
      if (frame.protocol !== undefined && frame.protocol !== CHANNEL_PROTOCOL_VERSION) {
        const message =
          frame.protocol > CHANNEL_PROTOCOL_VERSION
            ? `the sandbox's serve speaks a newer wire protocol (${frame.protocol}) than this Atlas (${CHANNEL_PROTOCOL_VERSION}) — update Atlas, then re-open the conversation`
            : `the sandbox's serve speaks an older wire protocol (${frame.protocol}) than this Atlas (${CHANNEL_PROTOCOL_VERSION}) — re-open the conversation so the sandbox's serve is rebuilt`
        abandoned = true
        failures.emit({ message })
        serverErrors.emit({ message })
        endStrandedStep()
        moveTo({ state: EChannelConnection.Closed, detail: message })
        socket?.close()
        return
      }
      attempt = 0
      reattachments = 0
      upstream.attach({ write })
      readies.emit({ turnInFlight: frame.turnInFlight === true })
      moveTo({ state: EChannelConnection.Open, detail: null })
      if (interruptPending && frame.turnInFlight === true) requestInterrupt()
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
    if (frame.kind === EServeFrame.TurnEnded) {
      interruptPending = false
      turnEndings.emit(turnOutcomeFromWire(frame.outcome))
      return
    }
    if (frame.kind === EServeFrame.InterruptAcked) {
      interruptPending = false
      interruptAcks.emit({ turnInFlight: true })
      return
    }
    if (frame.kind === EServeFrame.Roster) {
      rosters.emit(frame.roster)
      return
    }
    if (frame.kind === EServeFrame.Error) {
      failures.emit({ message: frame.message })
      serverErrors.emit({ message: frame.message })
    }
  }

  const handleOpen = () => {
    startKeepalive()
    write(
      encodeFrame({
        kind: EClientFrame.Hello,
        threadId: args.threadId,
        channelCursor,
        lastEventSeq: lastEventSeq(),
        protocol: CHANNEL_PROTOCOL_VERSION,
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

  const applyAttachment = (next: { url: string; token: string }) => {
    url = next.url
    token = next.token
    attempt = 0
    generation += 1
    clearKeepalive()
    const stale = socket
    socket = null
    stale?.close()
    moveTo({ state: EChannelConnection.Connecting, detail: null })
    connect()
  }

  const escalate = (reattach: () => Promise<{ url: string; token: string }>) => {
    generation += 1
    reattachments += 1
    endStrandedStep()
    moveTo({ state: EChannelConnection.Reattaching, detail: null })
    const scheduled = generation
    reattach().then(
      (next) => {
        if (abandoned || scheduled !== generation) return
        applyAttachment(next)
      },
      (failure) => {
        if (abandoned || scheduled !== generation) return
        moveTo({
          state: EChannelConnection.Closed,
          detail:
            `The session socket closed and did not reopen after ${maxAttempts} attempts, ` +
            `and re-attaching to the sandbox failed: ${
              failure instanceof Error ? failure.message : String(failure)
            }`,
        })
      },
    )
  }

  const handleClose = () => {
    socket = null
    clearKeepalive()
    upstream.detach({ reason: 'the session socket closed' })
    if (abandoned) return

    // Told in words (EServeFrame.Parked) before the close: the sandbox is gone on purpose, so
    // retrying its URL is futile — waking it is the turn runner's job on the next action.
    if (connection.state === EChannelConnection.Parked) return

    if (attempt >= maxAttempts) {
      if (args.reattach !== undefined && reattachments < maxReattachments) {
        escalate(args.reattach)
        return
      }
      endStrandedStep()
      moveTo({
        state: EChannelConnection.Closed,
        detail: `The session socket closed and did not reopen after ${maxAttempts} attempts.`,
      })
      return
    }

    const startingRetryCycle = attempt === 0
    const delayMs = backoffMs({ attempt })
    attempt += 1
    moveTo({ state: EChannelConnection.Reconnecting, detail: null })
    const scheduled = generation
    scheduleRetry({
      delayMs,
      run: () => {
        if (scheduled === generation) connect()
      },
    })

    const reattach = args.reattach
    const shouldEscalate = args.shouldEscalate
    if (
      startingRetryCycle &&
      reattach !== undefined &&
      shouldEscalate !== undefined &&
      reattachments < maxReattachments
    ) {
      shouldEscalate().then(
        (escalateNow) => {
          if (scheduled !== generation || !escalateNow) return
          escalate(reattach)
        },
        () => undefined,
      )
    }
  }

  const handleError = (message: string) => failures.emit({ message })

  const connect = () => {
    if (abandoned) return
    let mine: ChannelSocket | null = null
    const guarded = <A extends unknown[]>(handler: (...args: A) => void) =>
      (...args: A) => {
        if (mine !== null && socket === mine) handler(...args)
      }
    mine = socketFactory({
      url: sessionSocketUrlOf(url),
      protocols: [CHANNEL_SUBPROTOCOL, bearerSubprotocolOf(token)],
      handlers: {
        handleOpen: guarded(() => handleOpen()),
        handleMessage: guarded((data: string) => handleMessage(data)),
        handlePing: guarded(() => handlePing()),
        handleClose: guarded(() => handleClose()),
        handleError: guarded((message: string) => handleError(message)),
      },
    })
    socket = mine
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

    send: ({ text, images, context }) =>
      upstream.send({
        kind: EClientFrame.Send,
        text,
        ...(images === undefined || images.length === 0 ? {} : { images: [...images] }),
        ...(context === undefined || context.length === 0 ? {} : { context: [...context] }),
      }),

    run: () => upstream.send({ kind: EClientFrame.Run }),

    interrupt: requestInterrupt,

    request: (request) => upstream.request(request),

    connection: () => connection,

    onConnection: (listener) => connections.add(listener),

    onReload: (listener) => reloads.add(listener),

    onReady: (listener) => readies.add(listener),

    onInterruptAck: (listener) => interruptAcks.add(listener),

    onRoster: (listener) => rosters.add(listener),

    onTurnEnded: (listener) => turnEndings.add(listener),

    onError: (listener) => failures.add(listener),

    onServerError: (listener) => serverErrors.add(listener),

    wake({ url: nextUrl, token: nextToken }) {
      if (abandoned) return

      reattachments = 0
      applyAttachment({ url: nextUrl, token: nextToken })
    },

    close() {
      abandoned = true
      interruptPending = false
      endStrandedStep()
      upstream.detach({ reason: 'the channel was closed' })
      clearKeepalive()
      socket?.close()
      socket = null
      moveTo({ state: EChannelConnection.Closed, detail: null })
    },
  }
}
