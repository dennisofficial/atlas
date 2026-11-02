import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_MIN_VERSION,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  ECapability,
  EClientFrame,
  encodeFrame,
} from './channel-wire'
import { EConnectionView, ESocketLiveness } from './connection-view'
import { DEFAULT_KEEPALIVE_MS } from './keepalive'
import { createFrameHandler } from './remote-channel-frames'
import type { ChannelCore } from './remote-channel-core'
import { attemptBudgetFor, exhaustedDetailOf } from './remote-channel-facts'
import { sessionSocketUrlOf, type ChannelSocket } from './remote-channel-socket'
import type { SandboxAttachment } from './remote-delta-channel-types'
import { ERuntimePhase } from '@dltech/atlas-wire/web'

const restingPhase = (phase: ERuntimePhase | null): boolean =>
  phase === ERuntimePhase.Parked || phase === ERuntimePhase.Parking

export function createChannelLifecycle(core: ChannelCore) {
  const { state, args, facts, upstream, on } = core
  const { handleMessage } = createFrameHandler(core)

  const handleOpen = () => {
    core.clearKeepalive()
    state.stopKeepalive = core.scheduleKeepalive({
      intervalMs: args.keepaliveMs ?? DEFAULT_KEEPALIVE_MS,
      run: () => core.write(encodeFrame({ kind: EClientFrame.Pong })),
    })
    const head = core.lastEventSeq()
    const hello = (seq: number): string =>
      encodeFrame({
        kind: EClientFrame.Hello,
        threadId: args.threadId,
        channelCursor: state.channelCursor,
        lastEventSeq: seq,
        protocol: CHANNEL_PROTOCOL_VERSION,
        minProtocol: CHANNEL_PROTOCOL_MIN_VERSION,
        capabilities: [ECapability.ModelAvailabilityControls],
      })

    if (typeof head === 'number') {
      core.write(hello(head))
      return
    }

    state.helloPending = true
    state.heldUntilHello = []
    const opening = state.generation
    void Promise.resolve(head).then((seq) => {
      if (state.abandoned || opening !== state.generation) return
      state.helloPending = false
      core.write(hello(seq))
      for (const frame of state.heldUntilHello.splice(0)) core.write(frame)
    })
  }

  const handleClose = () => {
    core.clearKeepalive()
    upstream.detach({ reason: 'the session socket closed' })
    facts.update({ socket: ESocketLiveness.Closed })
    if (state.abandoned) return
    const { phase } = facts.facts()
    if (restingPhase(phase)) return

    const budget = attemptBudgetFor({ phase, maxAttempts: core.maxAttempts })
    if (state.attempt >= budget) {
      const reason = exhaustedDetailOf(budget)
      core.endStrandedStep()
      facts.update({ waking: false, rotating: false, failure: reason })
      upstream.failWaiting({ reason })
      return
    }

    const delayMs = core.backoffMs({ attempt: state.attempt })
    state.attempt += 1
    const scheduled = state.generation
    core.scheduleRetry({
      delayMs,
      run: () => {
        if (state.abandoned || scheduled !== state.generation) return
        if (connect() !== null) state.generation += 1
      },
    })
  }

  const supersede = () => {
    const stale = state.socket
    state.socket = null
    stale?.close()
    state.generation += 1
  }

  const connect = (): ChannelSocket | null => {
    if (state.abandoned || state.url === undefined || state.token === undefined) return null
    supersede()
    facts.update({ socket: ESocketLiveness.Dialing })
    let mine: ChannelSocket | null = null
    const guarded =
      <A extends unknown[]>(handler: (...args: A) => void) =>
      (...handlerArgs: A) => {
        if (mine !== null && state.socket === mine) handler(...handlerArgs)
      }
    mine = core.socketFactory({
      url: sessionSocketUrlOf(state.url),
      protocols: [CHANNEL_SUBPROTOCOL, bearerSubprotocolOf(state.token)],
      handlers: {
        handleOpen: guarded(() => handleOpen()),
        handleMessage: guarded((data: string) => handleMessage(data)),
        handlePing: guarded(() => core.write(encodeFrame({ kind: EClientFrame.Pong }))),
        handleClose: guarded(() => handleClose()),
        handleError: guarded((message: string) => on.failures.emit({ message })),
      },
    })
    state.socket = mine
    return mine
  }

  const applyAttachment = (next: SandboxAttachment) => {
    state.url = next.url
    state.token = next.token
    state.attempt = 0
    core.clearKeepalive()
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
    if (state.abandoned || wakeSandbox === undefined) return
    const { socket: liveness } = facts.facts()
    supersede()
    if (liveness === ESocketLiveness.Open || liveness === ESocketLiveness.Dialing) {
      core.clearKeepalive()
      upstream.detach({ reason: 'the sandbox is being woken' })
    }
    core.endStrandedStep()
    facts.update({
      waking: true,
      rotating: false,
      failure: null,
      ...(liveness === ESocketLiveness.Unattached ? {} : { socket: ESocketLiveness.Closed }),
    })
    const scheduled = state.generation
    const onRotationStarted = () => {
      if (state.abandoned || scheduled !== state.generation) return
      facts.update({ rotating: true })
    }
    wakeSandbox({ onRotationStarted }).then(
      (next) => {
        if (state.abandoned || scheduled !== state.generation) return
        applyAttachment(next)
      },
      (failure: unknown) => {
        if (state.abandoned || scheduled !== state.generation) return
        const reason = `the pod could not be woken: ${failure instanceof Error ? failure.message : String(failure)}`
        on.failures.emit({ message: reason })
        failWake(reason)
      },
    )
  }

  const kickWake = () => {
    if (facts.facts().waking) return
    const { state: view } = facts.view()
    if (view !== EConnectionView.Parked && view !== EConnectionView.Disconnected) return
    startWake()
  }

  const shutDown = (shutdown: { reason: string; beforeAbandon: () => void }) => {
    core.deliver({ type: 'operator-input', request: null })
    state.abandoned = true
    state.interruptPending = false
    shutdown.beforeAbandon()
    upstream.abandon({ reason: shutdown.reason })
    args.onFinished?.()
    core.clearKeepalive()
    state.socket?.close()
    state.socket = null
  }

  return { connect, applyAttachment, failWake, startWake, kickWake, shutDown }
}
