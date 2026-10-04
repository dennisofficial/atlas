import { saidBody, toThreadId, type EventDraft, type SaidFile, type SaidImage, type ThreadId } from '@dltech/atlas-core'

import type { ChannelListener, DeltaChannel, Unsubscribe } from '../channel/delta-channel'
import { retainReplayable, type InFlightSlots } from '../channel/in-flight'
import { EStepEnd, type ChannelSignal, type StepId, type StepSignal } from '../channel/signal'
import type { TurnOutcome } from '../loop/turn-outcome'
import {
  runtimeCheckpointSchema,
  type PendingEntryWire,
  type PrStateWire,
  type RosterWire,
  type RuntimeCheckpoint,
} from '@dltech/atlas-wire'

import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  decodeServeFrame,
  EClientFrame,
  type EClientRequest,
  encodeFrame,
  EServeFrame,
  toSendId,
  turnOutcomeFromWire,
  type ServeFrame,
} from './channel-wire'
import {
  sessionSocketUrlOf,
  webSocketFactory,
  type ChannelSocket,
  type ChannelSocketFactory,
} from './remote-channel-socket'
import { createUpstreamPipe, RemotePublishRefused, RemoteRequestLost } from './remote-channel-upstream'
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
  Waking = 'waking',
  Closed = 'closed',
}

export enum EReconnectEscalation {
  Reattach = 'reattach',
  Wait = 'wait',
  Parked = 'parked',
}

export type ChannelConnection = { state: EChannelConnection; detail: string | null }

export type ChannelReload = { sinceEventSeq: number }

export type ChannelFailure = { message: string }

export type { RuntimeCheckpoint } from '@dltech/atlas-wire'

/** What the serve said about itself at greet — whether the turn it was running survived, and whether it vouches the client's durable log is whole. */
export type ChannelReady = { turnInFlight: boolean; transcriptCurrent?: boolean | undefined }

/** The far side received the interrupt frame and aborted the turn it was driving. */
export type InterruptAck = { turnInFlight: boolean }

export type ThreadRenamedFrame = { threadId: ThreadId; title: string }

export type ThreadModelChangedFrame = { threadId: ThreadId; model: { ref: string; effort: string } }

export const INTERRUPT_ACK_TIMEOUT_MS = 5_000

export const STRANDED_STEP_END = EStepEnd.Detached

export type RemoteDeltaChannel = DeltaChannel & {
  readonly threadId: ThreadId
  send(args: {
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
    context?: readonly EventDraft[] | undefined
  }): void
  run(args?: { resume?: boolean }): void
  interrupt(): void
  pause(): void
  resume(): void
  syncSettings(args: { content: string }): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  connection(): ChannelConnection
  onConnection(listener: (connection: ChannelConnection) => void): Unsubscribe
  onReload(listener: (reload: ChannelReload) => void): Unsubscribe
  onReady(listener: (ready: ChannelReady) => void): Unsubscribe
  onInterruptAck(listener: (ack: InterruptAck) => void): Unsubscribe
  onRoster(listener: (roster: RosterWire) => void): Unsubscribe
  onPrStates(listener: (states: readonly PrStateWire[]) => void): Unsubscribe
  pendingEntries(): readonly PendingEntryWire[]
  onPendingChanged(listener: (entries: readonly PendingEntryWire[]) => void): Unsubscribe
  onThreadRenamed(listener: (renamed: ThreadRenamedFrame) => void): Unsubscribe
  onThreadModelChanged(listener: (changed: ThreadModelChangedFrame) => void): Unsubscribe
  onTurnEnded(listener: (outcome: TurnOutcome) => void): Unsubscribe
  onError(listener: (failure: ChannelFailure) => void): Unsubscribe
  onServerError(listener: (failure: ChannelFailure) => void): Unsubscribe
  checkpoint?(): RuntimeCheckpoint | null
  onCheckpoint?(listener: (checkpoint: RuntimeCheckpoint) => void): Unsubscribe
  detach?(): void
  onDetached?(listener: (reason: string) => void): Unsubscribe
  wake(args: { url: string; token: string }): void
  /**
   * Marks the channel as waking its sandbox. The wake itself is a control-plane call the turn
   * runner awaits before `wake()` has a fresh attachment to apply, and without this state that
   * whole window still reads as Parked — or worse, Closed — to whoever is watching.
   */
  beginWake(): void
  /**
   * Re-attach from a stranded Closed state. The operator asked for it, so the reattachment budget
   * the automatic retries spent does not apply — a manual reconnect always escalates again. No-op
   * while the channel is anything but Closed, and without a `reattach` configured.
   */
  reconnect(): void
  close(): void
}

const RETRY_CEILING_MS = 30_000
const FIRST_RETRY_MS = 500
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_MAX_REATTACHMENTS = 3

const NOTHING_IN_FLIGHT: readonly StepSignal[] = Object.freeze([])

const NOTHING_PENDING: readonly PendingEntryWire[] = Object.freeze([])

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
  /** Absent means deferred: start {@link EChannelConnection.Parked} and open nothing until `wake`. */
  url?: string | undefined
  token?: string | undefined
  lastEventSeq?: (() => number) | undefined
  socketFactory?: ChannelSocketFactory | undefined
  scheduleRetry?: ((retry: { delayMs: number; run: () => void }) => void) | undefined
  scheduleTimeout?: ((timeout: { delayMs: number; run: () => void }) => void) | undefined
  scheduleKeepalive?: ScheduleKeepalive | undefined
  backoffMs?: ((args: { attempt: number }) => number) | undefined
  maxAttempts?: number | undefined
  lifecycleEscalation?: (() => Promise<EReconnectEscalation>) | undefined
  requestTimeoutMs?: number | undefined
  /**
   * A request issued while the wire is down queues and its answer clock starts only once the
   * frame reaches a socket; this bounds how long "queued behind a wake" may last before the
   * caller is told the request never left.
   */
  unwrittenRequestTimeoutMs?: number | undefined
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
  onFinished?: (() => void) | undefined
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
  const prStates = registryOf<readonly PrStateWire[]>()
  const pendingChanges = registryOf<readonly PendingEntryWire[]>()
  const threadRenames = registryOf<ThreadRenamedFrame>()
  const threadModelChanges = registryOf<ThreadModelChangedFrame>()
  const checkpoints = registryOf<RuntimeCheckpoint>()
  const detachments = registryOf<string>()
  const turnEndings = registryOf<TurnOutcome>()
  const failures = registryOf<ChannelFailure>()
  const serverErrors = registryOf<ChannelFailure>()
  const upstream = createUpstreamPipe({
    timeoutMs: args.requestTimeoutMs,
    unwrittenTimeoutMs: args.unwrittenRequestTimeoutMs,
    scheduleTimeout,
  })

  let inFlight: StepSignal[] = []
  const toolOutputSlots: InFlightSlots = new Map()
  let replay: readonly ChannelSignal[] | undefined
  let operatorInput: Extract<ChannelSignal, { type: 'operator-input' }> | null = null
  let stepId: StepId | undefined
  let working = false
  let channelCursor: number | null = null
  let attempt = 0
  let reattachments = 0
  let socket: ChannelSocket | null = null
  let stopKeepalive: (() => void) | null = null
  let abandoned = false
  let generation = 0
  let url = args.url
  let token = args.token
  const attached = url !== undefined && token !== undefined
  let connection: ChannelConnection = attached
    ? { state: EChannelConnection.Connecting, detail: null }
    : { state: EChannelConnection.Parked, detail: null }
  let interruptPending = false
  let interruptSentGeneration = -1
  let heldCheckpoint: RuntimeCheckpoint | null = null
  let heldPending: readonly PendingEntryWire[] = NOTHING_PENDING

  const settlePending = (entries: readonly PendingEntryWire[]): void => {
    heldPending = entries
    pendingChanges.emit(entries)
  }

  const acceptCheckpoint = (checkpoint: RuntimeCheckpoint | null | undefined): void => {
    if (checkpoint === null || checkpoint === undefined) return
    if (checkpoint.threadId !== args.threadId) return
    if (heldCheckpoint !== null && checkpoint.revision <= heldCheckpoint.revision) return
    heldCheckpoint = checkpoint
    checkpoints.emit(heldCheckpoint)
  }

  const checkpointFrom = (raw: string): RuntimeCheckpoint | null | undefined => {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const checkpoint = Reflect.get(parsed, 'checkpoint')
    if (checkpoint === null) return null
    const valid = runtimeCheckpointSchema.safeParse(checkpoint)
    return valid.success ? valid.data : undefined
  }

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

  const WORKING_SIGNAL: StepSignal = Object.freeze({ type: 'turn-working', working: true })

  const stableReplay = (): readonly ChannelSignal[] => {
    if (replay !== undefined) return replay
    if (!working && inFlight.length === 0 && operatorInput === null) return NOTHING_IN_FLIGHT
    const held: ChannelSignal[] = working ? [WORKING_SIGNAL, ...inFlight] : [...inFlight]
    if (operatorInput !== null) held.push(operatorInput)
    replay = Object.freeze(held)
    return replay
  }

  const absorb = (signal: ChannelSignal) => {
    if (signal.type === 'pending-changed') return
    if (signal.type === 'operator-input') {
      operatorInput = signal.request === null ? null : signal
      replay = undefined
      return
    }
    if (signal.type === 'turn-working') {
      working = signal.working
      replay = undefined
      return
    }
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
    if (signal.type === 'pending-changed') settlePending(signal.entries)
  }

  const endStrandedStep = () => {
    if (stepId === undefined) return
    deliver({ type: 'step-ended', stepId, end: STRANDED_STEP_END, supersededBy: null })
  }

  const moveTo = (next: ChannelConnection) => {
    connection = next
    // A parked serve never answers again: fail the waiters now rather than at their timeouts.
    if (next.state === EChannelConnection.Parked) {
      upstream.failWaiting({
        reason:
          next.detail === null ? 'the sandbox is parked' : `the sandbox is parked (${next.detail})`,
      })
    }
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
      acceptCheckpoint(frame.checkpoint)
      attempt = 0
      reattachments = 0
      upstream.attach({ write })
      const turnInFlight = frame.turnInFlight === true
      if (turnInFlight !== working) deliver({ type: 'turn-working', working: turnInFlight })
      // The serve sends the fresh pending snapshot right after Ready, so an empty list first
      // clears whatever copy a reconnecting client kept from before it detached.
      settlePending(NOTHING_PENDING)
      readies.emit({
        turnInFlight: frame.turnInFlight === true,
        transcriptCurrent: frame.transcriptCurrent,
      })
      moveTo({ state: EChannelConnection.Open, detail: null })
      if (interruptPending && frame.turnInFlight === true) requestInterrupt()
      return
    }
    if (frame.kind === EServeFrame.Signal) {
      // One frame every seq, so a jump means the stream lost what sits between — the live half
      // of a transcript can never show a gap, so the durable log is re-read instead.
      if (channelCursor !== null && frame.seq > channelCursor + 1) {
        channelCursor = null
        endStrandedStep()
        reloads.emit({ sinceEventSeq: lastEventSeq() })
        return
      }
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
      acceptCheckpoint(frame.checkpoint)
      endStrandedStep()
      moveTo({ state: EChannelConnection.Parked, detail: frame.reason })
      return
    }
    if (frame.kind === EServeFrame.Checkpoint) {
      acceptCheckpoint(frame.checkpoint)
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
    if (frame.kind === EServeFrame.SendAcked) {
      upstream.ackSend({ sendId: frame.sendId })
      return
    }
    if (frame.kind === EServeFrame.Roster) {
      rosters.emit(frame.roster)
      return
    }
    if (frame.kind === EServeFrame.PrStates) {
      prStates.emit(frame.states)
      return
    }
    if (frame.kind === EServeFrame.ThreadRenamed) {
      threadRenames.emit({ threadId: toThreadId(frame.threadId), title: frame.title })
      return
    }
    if (frame.kind === EServeFrame.ThreadModelChanged) {
      threadModelChanges.emit({
        threadId: toThreadId(frame.threadId),
        model: { ref: frame.model.ref, effort: frame.model.effort },
      })
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
      const checkpoint = checkpointFrom(data)
      acceptCheckpoint(checkpoint)
      if (checkpoint !== undefined) return
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
    clearKeepalive()
    moveTo({ state: EChannelConnection.Connecting, detail: null })
    connect()
  }

  const escalate = (reattach: () => Promise<{ url: string; token: string }>, forQueuedWork = false) => {
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
        const cause = failure instanceof Error ? failure.message : String(failure)
        const detail = forQueuedWork
          ? `The sandbox could not be woken for the queued work: ${cause}`
          : `The session socket closed and did not reopen after ${maxAttempts} attempts, ` +
            `and re-attaching to the sandbox failed: ${cause}`
        upstream.failUnwritten({ reason: detail })
        moveTo({ state: EChannelConnection.Closed, detail })
      },
    )
  }

  /**
   * Operator intent beats a dead wire: any outgoing frame against a parked or closed sandbox
   * starts the same re-attach the transport recovery escalates to, and the queued pipe delivers
   * everything once the fresh socket greets. Turn frames reach here through the turn runner's
   * own wake ceremony, so this exists for everything else — requests and publishes alike.
   */
  const kickWake = () => {
    if (abandoned) return
    const reattach = args.reattach
    if (reattach === undefined) return
    if (
      connection.state !== EChannelConnection.Parked &&
      connection.state !== EChannelConnection.Closed
    ) {
      return
    }
    reattachments = 0
    escalate(reattach, true)
  }

  const handleClose = () => {
    clearKeepalive()
    upstream.detach({ reason: 'the session socket closed' })
    if (abandoned) return

    // Told in words (EServeFrame.Parked) before the close: the sandbox is gone on purpose, so
    // retrying its URL is futile — the next wire action wakes it instead (see kickWake).
    if (connection.state === EChannelConnection.Parked) return

    if (attempt >= maxAttempts) {
      const reattach = args.reattach
      if (reattach !== undefined && reattachments < maxReattachments) {
        if (args.lifecycleEscalation === undefined) {
          escalate(reattach)
          return
        }
        const inspectedGeneration = generation
        void args.lifecycleEscalation().then((verdict) => {
          if (abandoned || inspectedGeneration !== generation || connection.state === EChannelConnection.Open) return
          if (verdict === EReconnectEscalation.Reattach) {
            escalate(reattach)
            return
          }
          endStrandedStep()
          moveTo({ state: verdict === EReconnectEscalation.Parked ? EChannelConnection.Parked : EChannelConnection.Closed, detail: 'the sandbox was not woken by transport recovery' })
        }).catch(() => {
          if (abandoned || inspectedGeneration !== generation || connection.state === EChannelConnection.Open) return
          endStrandedStep()
          moveTo({ state: EChannelConnection.Closed, detail: 'the sandbox lifecycle could not be read' })
        })
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
        if (abandoned || scheduled !== generation) return
        if (connect() !== null) generation += 1
      },
    })

    const reattach = args.reattach
    const shouldEscalate = args.shouldEscalate
    const reattachOnLifecycle = args.reattach
    const lifecycleEscalation = args.lifecycleEscalation
    if (
      startingRetryCycle &&
      reattachOnLifecycle !== undefined &&
      reattachments < maxReattachments &&
      (shouldEscalate !== undefined || lifecycleEscalation !== undefined)
    ) {
      const verdict = async (): Promise<EReconnectEscalation> => {
        if (lifecycleEscalation !== undefined) return lifecycleEscalation()
        if (shouldEscalate === undefined) return EReconnectEscalation.Wait
        return await shouldEscalate() ? EReconnectEscalation.Reattach : EReconnectEscalation.Wait
      }
      verdict().then(
        (state) => {
          if (abandoned || scheduled !== generation || connection.state === EChannelConnection.Open) return
          if (state === EReconnectEscalation.Parked) {
            generation += 1
            endStrandedStep()
            moveTo({ state: EChannelConnection.Parked, detail: 'the sandbox is parked' })
            return
          }
          if (state === EReconnectEscalation.Reattach) escalate(reattachOnLifecycle)
        },
        () => undefined,
      )
    }
  }

  const handleError = (message: string) => failures.emit({ message })

  // A fresh attempt takes over from whatever dial preceded it, so the handlers it closes over
  // never fire again: the old close() could otherwise land while the channel is Connecting
  // (nothing in `socket` points at the dead socket yet) and start a retry cycle out from under
  // the live attempt.
  const supersede = () => {
    const stale = socket
    socket = null
    stale?.close()
    generation += 1
  }

  const connect = (): ChannelSocket | null => {
    if (abandoned || url === undefined || token === undefined) return null
    supersede()
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
    return mine
  }

  if (attached) connect()

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

    send: ({ text, images, files, context }) => {
      kickWake()
      upstream.send({
        kind: EClientFrame.Send,
        sendId: toSendId(crypto.randomUUID()),
        ...saidBody({ text, images, files }),
        ...(context === undefined || context.length === 0 ? {} : { context: [...context] }),
      })
    },

    run: (runArgs) => {
      kickWake()
      upstream.send({
        kind: EClientFrame.Run,
        ...(runArgs?.resume === true ? { resume: true } : {}),
      })
    },

    interrupt: requestInterrupt,

    pause: () => upstream.send({ kind: EClientFrame.Pause }),

    resume: () => upstream.send({ kind: EClientFrame.Resume }),

    syncSettings({ content }) {
      if (abandoned) return
      upstream.send({ kind: EClientFrame.Settings, content })
    },

    request: (request) => {
      if (abandoned) {
        return Promise.reject(
          new RemoteRequestLost({ op: request.op, reason: 'the channel is closed' }),
        )
      }
      if (connection.state === EChannelConnection.Parked && args.reattach === undefined) {
        return Promise.reject(
          new RemoteRequestLost({ op: request.op, reason: 'the sandbox is parked' }),
        )
      }
      kickWake()
      return upstream.request(request)
    },

    connection: () => connection,

    onConnection: (listener) => connections.add(listener),

    onReload: (listener) => reloads.add(listener),

    onReady: (listener) => readies.add(listener),

    onInterruptAck: (listener) => interruptAcks.add(listener),

    onRoster: (listener) => rosters.add(listener),
    onPrStates: (listener) => prStates.add(listener),

    pendingEntries: () => heldPending,

    onPendingChanged: (listener) => pendingChanges.add(listener),

    onThreadRenamed: (listener) => threadRenames.add(listener),

    onThreadModelChanged: (listener) => threadModelChanges.add(listener),

    onTurnEnded: (listener) => turnEndings.add(listener),

    onError: (listener) => failures.add(listener),

    onServerError: (listener) => serverErrors.add(listener),

    checkpoint: () => heldCheckpoint,

    onCheckpoint: (listener) => checkpoints.add(listener),

    wake({ url: nextUrl, token: nextToken }) {
      if (abandoned) return

      reattachments = 0
      applyAttachment({ url: nextUrl, token: nextToken })
    },

    beginWake() {
      if (abandoned) return
      if (
        connection.state !== EChannelConnection.Parked &&
        connection.state !== EChannelConnection.Closed
      ) {
        return
      }
      moveTo({ state: EChannelConnection.Waking, detail: null })
    },

    reconnect() {
      if (abandoned) return
      if (
        connection.state !== EChannelConnection.Closed &&
        connection.state !== EChannelConnection.Parked
      ) {
        return
      }
      const reattach = args.reattach
      if (reattach === undefined) return

      if (connection.state === EChannelConnection.Parked) {
        reattachments = 0
        escalate(reattach)
        return
      }
      const lifecycleEscalation = args.lifecycleEscalation
      if (lifecycleEscalation !== undefined) {
        void lifecycleEscalation().then(
          (verdict) => {
            if (abandoned) return
            if (connection.state !== EChannelConnection.Closed &&
              connection.state !== EChannelConnection.Parked
            ) {
              return
            }
            if (verdict !== EReconnectEscalation.Reattach) return
            reattachments = 0
            escalate(reattach)
          },
          () => undefined,
        )
        return
      }

      reattachments = 0
      escalate(reattach)
    },

    detach() {
      if (abandoned) return
      deliver({ type: 'operator-input', request: null })
      abandoned = true
      interruptPending = false
      heldCheckpoint = null
      stepId = undefined
      inFlight = []
      toolOutputSlots.clear()
      working = false
      replay = undefined
      upstream.abandon({ reason: 'the channel detached' })
      args.onFinished?.()
      clearKeepalive()
      socket?.close()
      socket = null
      detachments.emit('The session detached from the sandbox turn.')
      moveTo({ state: EChannelConnection.Closed, detail: null })
    },

    onDetached: (listener) => detachments.add(listener),

    close() {
      deliver({ type: 'operator-input', request: null })
      abandoned = true
      interruptPending = false
      endStrandedStep()
      upstream.abandon({ reason: 'the channel was closed' })
      args.onFinished?.()
      clearKeepalive()
      socket?.close()
      socket = null
      moveTo({ state: EChannelConnection.Closed, detail: null })
    },
  }
}
