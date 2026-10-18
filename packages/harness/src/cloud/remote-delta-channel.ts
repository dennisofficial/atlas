import { saidBody, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ERuntimePhase, type PendingEntryWire, type PrStateWire, type RosterWire, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { ChannelListener } from '../channel/delta-channel'
import type { ChannelSignal } from '../channel/signal'
import type { TurnOutcome } from '../loop/turn-outcome'
import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  decodeServeFrame,
  EClientFrame,
  encodeFrame,
  EServeFrame,
  toSendId,
  turnOutcomeFromWire,
  type ServeFrame,
} from './channel-wire'
import { EConnectionView, ESocketLiveness } from './connection-view'
import { DEFAULT_KEEPALIVE_MS, intervalKeepaliveScheduler, type ScheduleKeepalive } from './keepalive'
import { checkpointFrom, createCheckpointHolder } from './remote-channel-checkpoint'
import { attemptBudgetFor, createConnectionFacts, DEFAULT_MAX_ATTEMPTS, exhaustedDetailOf } from './remote-channel-facts'
import { createInFlightReplay, NOTHING_IN_FLIGHT } from './remote-channel-in-flight'
import { registryOf } from './remote-channel-registry'
import { sessionSocketUrlOf, webSocketFactory, type ChannelSocket, type ChannelSocketFactory } from './remote-channel-socket'
import { createUpstreamPipe, RemotePublishRefused, RemoteRequestLost } from './remote-channel-upstream'
import {
  INTERRUPT_ACK_TIMEOUT_MS,
  STRANDED_STEP_END,
  type ChannelFailure,
  type ChannelReady,
  type ChannelReload,
  type InterruptAck,
  type RemoteDeltaChannel,
  type SandboxAttachment,
  type SandboxWake,
  type ThreadModelChangedFrame,
  type ThreadRenamedFrame,
} from './remote-delta-channel-types'

export { RemotePublishRefused, RemoteRequestFailed, RemoteRequestLost } from './remote-channel-upstream'
export type { ChannelSocket, ChannelSocketFactory, ChannelSocketHandlers } from './remote-channel-socket'
export * from './remote-delta-channel-types'
export type { RuntimeCheckpoint } from '@dltech/atlas-wire'

const RETRY_CEILING_MS = 30_000
const FIRST_RETRY_MS = 500

const NOTHING_PENDING: readonly PendingEntryWire[] = Object.freeze([])

const defaultBackoffMs = (args: { attempt: number }): number =>
  Math.min(RETRY_CEILING_MS, FIRST_RETRY_MS * 2 ** args.attempt)

const afterDelay = (task: { delayMs: number; run: () => void }) => {
  setTimeout(task.run, task.delayMs)
}

const restingPhase = (phase: ERuntimePhase | null): boolean =>
  phase === ERuntimePhase.Parked || phase === ERuntimePhase.Parking

const protocolMismatchOf = (protocol: number): string =>
  protocol > CHANNEL_PROTOCOL_VERSION
    ? `the sandbox's serve speaks a newer wire protocol (${protocol}) than this Atlas (${CHANNEL_PROTOCOL_VERSION}) — update Atlas, then re-open the conversation`
    : `the sandbox's serve speaks an older wire protocol (${protocol}) than this Atlas (${CHANNEL_PROTOCOL_VERSION}) — re-open the conversation so the sandbox's serve is rebuilt`

export function createRemoteDeltaChannel(args: {
  threadId: ThreadId
  /** Absent means deferred: the view reads Parked and nothing opens until a wake. */
  url?: string | undefined
  token?: string | undefined
  /**
   * The seq of the newest durable event the client holds for the thread, reported on the Hello so
   * the serve can vouch the log is current. A Promise holds the wire until the head resolves so the
   * Hello still leads. Absent means 0.
   */
  lastEventSeq?: (() => number | Promise<number>) | undefined
  socketFactory?: ChannelSocketFactory | undefined
  scheduleRetry?: ((retry: { delayMs: number; run: () => void }) => void) | undefined
  scheduleTimeout?: ((timeout: { delayMs: number; run: () => void }) => void) | undefined
  scheduleKeepalive?: ScheduleKeepalive | undefined
  backoffMs?: ((args: { attempt: number }) => number) | undefined
  maxAttempts?: number | undefined
  requestTimeoutMs?: number | undefined
  unwrittenRequestTimeoutMs?: number | undefined
  keepaliveMs?: number | undefined
  interruptAckTimeoutMs?: number | undefined
  /** Wakes (or re-attaches to) the sandbox through the control plane; the relaunched serve keeps its own turn. */
  wakeSandbox?: SandboxWake | undefined
  onFinished?: (() => void) | undefined
}): RemoteDeltaChannel {
  const lastEventSeq = args.lastEventSeq ?? (() => 0)
  const socketFactory = args.socketFactory ?? webSocketFactory
  const backoffMs = args.backoffMs ?? defaultBackoffMs
  const maxAttempts = args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const scheduleRetry = args.scheduleRetry ?? afterDelay
  const scheduleKeepalive = args.scheduleKeepalive ?? intervalKeepaliveScheduler
  const scheduleTimeout = args.scheduleTimeout ?? afterDelay

  const listeners = new Set<ChannelListener>()
  const interruptAcks = registryOf<InterruptAck>()
  const reloads = registryOf<ChannelReload>()
  const readies = registryOf<ChannelReady>()
  const rosters = registryOf<RosterWire>()
  const prStates = registryOf<readonly PrStateWire[]>()
  const pendingChanges = registryOf<readonly PendingEntryWire[]>()
  const threadRenames = registryOf<ThreadRenamedFrame>()
  const threadModelChanges = registryOf<ThreadModelChangedFrame>()
  const detachments = registryOf<string>()
  const turnEndings = registryOf<TurnOutcome>()
  const failures = registryOf<ChannelFailure>()
  const serverErrors = registryOf<ChannelFailure>()
  const checkpoints = createCheckpointHolder({ threadId: args.threadId })
  const inFlight = createInFlightReplay()
  const upstream = createUpstreamPipe({
    timeoutMs: args.requestTimeoutMs,
    unwrittenTimeoutMs: args.unwrittenRequestTimeoutMs,
    scheduleTimeout,
  })

  let url = args.url
  let token = args.token
  const attached = url !== undefined && token !== undefined
  const facts = createConnectionFacts({
    phase: null,
    socket: attached ? ESocketLiveness.Dialing : ESocketLiveness.Unattached,
    waking: attached,
    rotating: false,
    failure: null,
    detached: false,
  })

  let channelCursor: number | null = null
  let attempt = 0
  let socket: ChannelSocket | null = null
  let stopKeepalive: (() => void) | null = null
  let abandoned = false
  let generation = 0
  let interruptPending = false
  let interruptSentGeneration = -1
  let heldPending: readonly PendingEntryWire[] = NOTHING_PENDING

  const settlePending = (entries: readonly PendingEntryWire[]): void => {
    heldPending = entries
    pendingChanges.emit(entries)
  }

  const acceptCheckpoint = (checkpoint: RuntimeCheckpoint | null | undefined): void => {
    const accepted = checkpoints.accept(checkpoint)
    if (accepted !== null) facts.update({ phase: accepted.phase })
  }

  const requestInterrupt = () => {
    interruptPending = true
    interruptSentGeneration = generation
    upstream.send({ kind: EClientFrame.Interrupt })
    const sentGeneration = generation
    scheduleTimeout({
      delayMs: args.interruptAckTimeoutMs ?? INTERRUPT_ACK_TIMEOUT_MS,
      run: () => {
        if (!interruptPending || interruptSentGeneration !== sentGeneration) return
        if (facts.facts().socket !== ESocketLiveness.Open) return
        failures.emit({ message: 'The sandbox never acknowledged the interrupt.' })
      },
    })
  }

  let helloPending = false
  let heldUntilHello: string[] = []

  const write = (data: string): boolean => {
    if (helloPending) {
      heldUntilHello.push(data)
      return true
    }
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

  const deliver = (signal: ChannelSignal) => {
    inFlight.absorb(signal)
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
    const stepId = inFlight.stepId()
    if (stepId === undefined) return
    deliver({ type: 'step-ended', stepId, end: STRANDED_STEP_END, supersededBy: null })
  }

  const handleReady = (frame: Extract<ServeFrame, { kind: EServeFrame.Ready }>) => {
    if (frame.protocol !== undefined && frame.protocol !== CHANNEL_PROTOCOL_VERSION) {
      const message = protocolMismatchOf(frame.protocol)
      abandoned = true
      failures.emit({ message })
      serverErrors.emit({ message })
      endStrandedStep()
      facts.update({ waking: false, rotating: false, failure: message })
      socket?.close()
      return
    }
    const accepted = checkpoints.accept(frame.checkpoint)
    attempt = 0
    upstream.attach({ write })
    const turnInFlight = frame.turnInFlight === true
    if (turnInFlight !== inFlight.working()) deliver({ type: 'turn-working', working: turnInFlight })
    settlePending(NOTHING_PENDING)
    readies.emit({ turnInFlight, transcriptCurrent: frame.transcriptCurrent })
    facts.update({
      phase: accepted?.phase ?? ERuntimePhase.Serving,
      socket: ESocketLiveness.Open,
      waking: false,
      rotating: false,
      failure: null,
    })
    if (interruptPending && turnInFlight) requestInterrupt()
  }

  const handleSignal = (frame: Extract<ServeFrame, { kind: EServeFrame.Signal }>) => {
    if (channelCursor !== null && frame.seq > channelCursor + 1) {
      channelCursor = null
      endStrandedStep()
      const head = lastEventSeq()
      if (typeof head === 'number') reloads.emit({ sinceEventSeq: head })
      else void Promise.resolve(head).then((seq) => reloads.emit({ sinceEventSeq: seq }))
      return
    }
    deliver(frame.signal)
    channelCursor = frame.seq
  }

  const handleFrame = (frame: ServeFrame) => {
    if (frame.kind === EServeFrame.Ready) return handleReady(frame)
    if (frame.kind === EServeFrame.Signal) return handleSignal(frame)
    if (frame.kind === EServeFrame.Reply) return upstream.settleReply({ replyTo: frame.replyTo, ok: frame.ok, data: frame.data })
    if (frame.kind === EServeFrame.Reload) {
      channelCursor = null
      endStrandedStep()
      reloads.emit({ sinceEventSeq: frame.sinceEventSeq })
      return
    }
    if (frame.kind === EServeFrame.Parked) {
      checkpoints.accept(frame.checkpoint)
      endStrandedStep()
      facts.update({ phase: ERuntimePhase.Parked, waking: false })
      return
    }
    if (frame.kind === EServeFrame.Checkpoint) return acceptCheckpoint(frame.checkpoint)
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
    if (frame.kind === EServeFrame.SendAcked) return upstream.ackSend({ sendId: frame.sendId })
    if (frame.kind === EServeFrame.Roster) return rosters.emit(frame.roster)
    if (frame.kind === EServeFrame.PrStates) return prStates.emit(frame.states)
    if (frame.kind === EServeFrame.ThreadRenamed) {
      return threadRenames.emit({ threadId: toThreadId(frame.threadId), title: frame.title })
    }
    if (frame.kind === EServeFrame.ThreadModelChanged) {
      return threadModelChanges.emit({
        threadId: toThreadId(frame.threadId),
        model: { ref: frame.model.ref, effort: frame.model.effort },
      })
    }
    if (frame.kind === EServeFrame.Error) {
      failures.emit({ message: frame.message })
      serverErrors.emit({ message: frame.message })
    }
  }

  const handleOpen = () => {
    clearKeepalive()
    stopKeepalive = scheduleKeepalive({
      intervalMs: args.keepaliveMs ?? DEFAULT_KEEPALIVE_MS,
      run: () => write(encodeFrame({ kind: EClientFrame.Pong })),
    })
    const head = lastEventSeq()
    const hello = (seq: number): string =>
      encodeFrame({
        kind: EClientFrame.Hello,
        threadId: args.threadId,
        channelCursor,
        lastEventSeq: seq,
        protocol: CHANNEL_PROTOCOL_VERSION,
      })

    if (typeof head === 'number') {
      write(hello(head))
      return
    }

    helloPending = true
    heldUntilHello = []
    const opening = generation
    void Promise.resolve(head).then((seq) => {
      if (abandoned || opening !== generation) return
      helloPending = false
      write(hello(seq))
      for (const frame of heldUntilHello.splice(0)) write(frame)
    })
  }

  const handleMessage = (data: string) => {
    const frame = decodeServeFrame(data)
    if (frame !== null) return handleFrame(frame)
    const checkpoint = checkpointFrom(data)
    acceptCheckpoint(checkpoint)
    if (checkpoint !== undefined) return
    failures.emit({ message: 'The sandbox sent a frame this client could not read.' })
  }

  const handleClose = () => {
    clearKeepalive()
    upstream.detach({ reason: 'the session socket closed' })
    facts.update({ socket: ESocketLiveness.Closed })
    if (abandoned) return
    const { phase } = facts.facts()
    if (restingPhase(phase)) return

    const budget = attemptBudgetFor({ phase, maxAttempts })
    if (attempt >= budget) {
      const reason = exhaustedDetailOf(budget)
      endStrandedStep()
      facts.update({ waking: false, rotating: false, failure: reason })
      upstream.failWaiting({ reason })
      return
    }

    const delayMs = backoffMs({ attempt })
    attempt += 1
    const scheduled = generation
    scheduleRetry({
      delayMs,
      run: () => {
        if (abandoned || scheduled !== generation) return
        if (connect() !== null) generation += 1
      },
    })
  }

  const supersede = () => {
    const stale = socket
    socket = null
    stale?.close()
    generation += 1
  }

  const connect = (): ChannelSocket | null => {
    if (abandoned || url === undefined || token === undefined) return null
    supersede()
    facts.update({ socket: ESocketLiveness.Dialing })
    let mine: ChannelSocket | null = null
    const guarded =
      <A extends unknown[]>(handler: (...args: A) => void) =>
      (...handlerArgs: A) => {
        if (mine !== null && socket === mine) handler(...handlerArgs)
      }
    mine = socketFactory({
      url: sessionSocketUrlOf(url),
      protocols: [CHANNEL_SUBPROTOCOL, bearerSubprotocolOf(token)],
      handlers: {
        handleOpen: guarded(() => handleOpen()),
        handleMessage: guarded((data: string) => handleMessage(data)),
        handlePing: guarded(() => write(encodeFrame({ kind: EClientFrame.Pong }))),
        handleClose: guarded(() => handleClose()),
        handleError: guarded((message: string) => failures.emit({ message })),
      },
    })
    socket = mine
    return mine
  }

  const applyAttachment = (next: SandboxAttachment) => {
    url = next.url
    token = next.token
    attempt = 0
    clearKeepalive()
    const { phase } = facts.facts()
    facts.update({ waking: true, failure: null, ...(restingPhase(phase) ? { phase: null } : {}) })
    connect()
  }

  const failWake = (reason: string) => {
    facts.update({ waking: false, rotating: false, failure: reason })
    upstream.failWaiting({ reason })
  }

  const startWake = () => {
    const wakeSandbox = args.wakeSandbox
    if (abandoned || wakeSandbox === undefined) return
    const { socket: liveness } = facts.facts()
    supersede()
    if (liveness === ESocketLiveness.Open || liveness === ESocketLiveness.Dialing) {
      clearKeepalive()
      upstream.detach({ reason: 'the sandbox is being woken' })
    }
    endStrandedStep()
    facts.update({
      waking: true,
      rotating: false,
      failure: null,
      ...(liveness === ESocketLiveness.Unattached ? {} : { socket: ESocketLiveness.Closed }),
    })
    const scheduled = generation
    const onRotationStarted = () => {
      if (abandoned || scheduled !== generation) return
      facts.update({ rotating: true })
    }
    wakeSandbox({ onRotationStarted }).then(
      (next) => {
        if (abandoned || scheduled !== generation) return
        applyAttachment(next)
      },
      (failure: unknown) => {
        if (abandoned || scheduled !== generation) return
        const reason = `the sandbox could not be woken: ${failure instanceof Error ? failure.message : String(failure)}`
        failures.emit({ message: reason })
        failWake(reason)
      },
    )
  }

  const kickWake = () => {
    if (facts.facts().waking) return
    const { state } = facts.view()
    if (state !== EConnectionView.Parked && state !== EConnectionView.Disconnected) return
    startWake()
  }

  const shutDown = (shutdown: { reason: string; beforeAbandon: () => void }) => {
    deliver({ type: 'operator-input', request: null })
    abandoned = true
    interruptPending = false
    shutdown.beforeAbandon()
    upstream.abandon({ reason: shutdown.reason })
    args.onFinished?.()
    clearKeepalive()
    socket?.close()
    socket = null
  }

  if (attached) connect()

  return {
    threadId: args.threadId,

    subscribe({ threadId, listener }) {
      if (threadId !== args.threadId) return () => undefined
      for (const signal of inFlight.replay()) listener(signal)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    snapshot: ({ threadId }) => (threadId === args.threadId ? inFlight.replay() : NOTHING_IN_FLIGHT),

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
      upstream.send({ kind: EClientFrame.Run, ...(runArgs?.resume === true ? { resume: true } : {}) })
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
        return Promise.reject(new RemoteRequestLost({ op: request.op, reason: 'the channel is closed' }))
      }
      const parked = facts.view().state === EConnectionView.Parked
      if (parked && args.wakeSandbox === undefined) {
        return Promise.reject(new RemoteRequestLost({ op: request.op, reason: 'the sandbox is parked' }))
      }
      kickWake()
      return upstream.request(request)
    },

    connection: () => facts.view(),
    onConnection: (listener) => facts.onView(listener),
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
    checkpoint: () => checkpoints.current(),
    onCheckpoint: (listener) => checkpoints.onCheckpoint(listener),

    observeCheckpoint(checkpoint) {
      if (abandoned) return
      acceptCheckpoint(checkpoint)
    },

    attachment() {
      if (url === undefined || token === undefined) return undefined
      return { url, token }
    },

    wake(next) {
      if (abandoned) return
      applyAttachment(next)
    },

    beginWake() {
      if (abandoned || facts.facts().socket === ESocketLiveness.Open) return
      facts.update({ waking: true, failure: null })
    },

    beginRotation() {
      if (abandoned || facts.facts().socket === ESocketLiveness.Open) return
      facts.update({ rotating: true })
    },

    failWake({ reason }) {
      if (abandoned) return
      failWake(reason)
    },

    reconnect() {
      if (abandoned) return
      const current = facts.facts()
      if (current.socket === ESocketLiveness.Open || current.waking) return
      startWake()
    },

    unackedSendCount: () => upstream.unackedSendCount(),

    detach() {
      if (abandoned) return
      shutDown({
        reason: 'the channel detached',
        beforeAbandon: () => {
          checkpoints.forget()
          inFlight.forget()
        },
      })
      detachments.emit('The session detached from the sandbox turn.')
      facts.update({ detached: true, waking: false })
    },

    onDetached: (listener) => detachments.add(listener),

    close() {
      shutDown({ reason: 'the channel was closed', beforeAbandon: endStrandedStep })
      facts.update({ detached: true, waking: false })
    },
  }
}
