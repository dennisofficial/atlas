import type {
  PendingEntryWire,
  PrStateWire,
  RosterWire,
  RuntimeCheckpoint,
  TerminalExitWire,
  TerminalOutputWire,
} from '@dltech/atlas-wire/web'

import { EClientFrame } from './channel-wire'
import { ESocketLiveness } from './connection-view'
import type { ChannelListener } from './delta-channel-types'
import { intervalKeepaliveScheduler } from './keepalive'
import { createCheckpointHolder } from './remote-channel-checkpoint'
import { createConnectionFacts, DEFAULT_MAX_ATTEMPTS } from './remote-channel-facts'
import { createInFlightReplay } from './remote-channel-in-flight'
import { registryOf } from './remote-channel-registry'
import { webSocketFactory, type ChannelSocket } from './remote-channel-socket'
import { createUpstreamPipe } from './remote-channel-upstream'
import {
  INTERRUPT_ACK_TIMEOUT_MS,
  STRANDED_STEP_END,
  type ChannelFailure,
  type ChannelReady,
  type ChannelReload,
  type InterruptAck,
  type RemoteDeltaChannelOptions,
  type ThreadModelChangedFrame,
  type ThreadRenamedFrame,
} from './remote-delta-channel-types'
import type { ChannelSignal } from './signal'
import type { TurnOutcome } from './turn-outcome'

const RETRY_CEILING_MS = 30_000
const FIRST_RETRY_MS = 500

export const NOTHING_PENDING: readonly PendingEntryWire[] = Object.freeze([])

const defaultBackoffMs = (args: { attempt: number }): number =>
  Math.min(RETRY_CEILING_MS, FIRST_RETRY_MS * 2 ** args.attempt)

const afterDelay = (task: { delayMs: number; run: () => void }) => {
  setTimeout(task.run, task.delayMs)
}

export type ChannelState = {
  url: string | undefined
  token: string | undefined
  channelCursor: number | null
  attempt: number
  socket: ChannelSocket | null
  stopKeepalive: (() => void) | null
  abandoned: boolean
  generation: number
  interruptPending: boolean
  interruptSentGeneration: number
  heldPending: readonly PendingEntryWire[]
  helloPending: boolean
  heldUntilHello: string[]
}

export function createChannelCore(args: RemoteDeltaChannelOptions) {
  const scheduleTimeout = args.scheduleTimeout ?? afterDelay
  const state: ChannelState = {
    url: args.url,
    token: args.token,
    channelCursor: null,
    attempt: 0,
    socket: null,
    stopKeepalive: null,
    abandoned: false,
    generation: 0,
    interruptPending: false,
    interruptSentGeneration: -1,
    heldPending: NOTHING_PENDING,
    helloPending: false,
    heldUntilHello: [],
  }
  const attached = state.url !== undefined && state.token !== undefined

  const listeners = new Set<ChannelListener>()
  const on = {
    interruptAcks: registryOf<InterruptAck>(),
    reloads: registryOf<ChannelReload>(),
    readies: registryOf<ChannelReady>(),
    rosters: registryOf<RosterWire>(),
    prStates: registryOf<readonly PrStateWire[]>(),
    terminalOutputs: registryOf<TerminalOutputWire>(),
    terminalExits: registryOf<TerminalExitWire>(),
    pendingChanges: registryOf<readonly PendingEntryWire[]>(),
    threadRenames: registryOf<ThreadRenamedFrame>(),
    threadModelChanges: registryOf<ThreadModelChangedFrame>(),
    detachments: registryOf<string>(),
    turnEndings: registryOf<TurnOutcome>(),
    failures: registryOf<ChannelFailure>(),
    serverErrors: registryOf<ChannelFailure>(),
  }
  const checkpoints = createCheckpointHolder({ threadId: args.threadId })
  const inFlight = createInFlightReplay()
  const upstream = createUpstreamPipe({
    timeoutMs: args.requestTimeoutMs,
    unwrittenTimeoutMs: args.unwrittenRequestTimeoutMs,
    scheduleTimeout,
  })
  const facts = createConnectionFacts({
    phase: null,
    socket: attached ? ESocketLiveness.Dialing : ESocketLiveness.Unattached,
    waking: attached,
    rotating: false,
    failure: null,
    detached: false,
  })

  const settlePending = (entries: readonly PendingEntryWire[]): void => {
    state.heldPending = entries
    on.pendingChanges.emit(entries)
  }

  const acceptCheckpoint = (checkpoint: RuntimeCheckpoint | null | undefined): void => {
    const accepted = checkpoints.accept(checkpoint)
    if (accepted !== null) facts.update({ phase: accepted.phase })
  }

  const requestInterrupt = () => {
    state.interruptPending = true
    state.interruptSentGeneration = state.generation
    upstream.send({ kind: EClientFrame.Interrupt })
    const sentGeneration = state.generation
    scheduleTimeout({
      delayMs: args.interruptAckTimeoutMs ?? INTERRUPT_ACK_TIMEOUT_MS,
      run: () => {
        if (!state.interruptPending || state.interruptSentGeneration !== sentGeneration) return
        if (facts.facts().socket !== ESocketLiveness.Open) return
        on.failures.emit({ message: 'The sandbox never acknowledged the interrupt.' })
      },
    })
  }

  const write = (data: string): boolean => {
    if (state.helloPending) {
      state.heldUntilHello.push(data)
      return true
    }
    const live = state.socket
    if (live === null) return false
    if (live.isOpen !== undefined && !live.isOpen()) return false
    live.send(data)
    return true
  }

  const clearKeepalive = () => {
    state.stopKeepalive?.()
    state.stopKeepalive = null
  }

  const deliver = (signal: ChannelSignal) => {
    inFlight.absorb(signal)
    for (const listener of [...listeners]) {
      try {
        listener(signal)
      } catch (error) {
        on.failures.emit({
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

  return {
    args,
    state,
    attached,
    listeners,
    on,
    checkpoints,
    inFlight,
    upstream,
    facts,
    lastEventSeq: args.lastEventSeq ?? (() => 0),
    socketFactory: args.socketFactory ?? webSocketFactory,
    backoffMs: args.backoffMs ?? defaultBackoffMs,
    maxAttempts: args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    scheduleRetry: args.scheduleRetry ?? afterDelay,
    scheduleKeepalive: args.scheduleKeepalive ?? intervalKeepaliveScheduler,
    scheduleTimeout,
    settlePending,
    acceptCheckpoint,
    requestInterrupt,
    write,
    clearKeepalive,
    deliver,
    endStrandedStep,
  }
}

export type ChannelCore = ReturnType<typeof createChannelCore>
