import { createSignalChatTransport } from '@dltech/atlas-client/chat'
import {
  createRemoteDeltaChannel,
  EConnectionView,
  type ChannelSignal,
  type SandboxAttachment,
} from '@dltech/atlas-client/channel'
import { toThreadId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import type { LiveThreadControllerArgs } from './live-thread-controller'
import { absorbInto, isStepSignal, RELEASED_FIELDS, settleInto } from './live-signals'
import { createLiveThreadActions } from './live-thread-actions'
import {
  IDLE_LIVE_THREAD,
  type LivePrepareRewind,
  type LiveSend,
  type LiveThreadState,
  type ServeChannel,
} from './live-thread-view'
import { EPodConnectOutcome, type PodConnectResult } from './pod-connect'
import { headOf, keepThrough } from './live-events'
import { localThreadReadChannel } from './local-thread-read-channel'
import { createLocalThreadHistory } from './local-thread-history'

type LocalControllerArgs = LiveThreadControllerArgs & { wake: () => Promise<PodConnectResult> }

export function createLocalThreadController(args: LocalControllerArgs) {
  const threadId = toThreadId(args.threadId)
  const signalTransport = createSignalChatTransport({ now: () => new Date() })
  let state = IDLE_LIVE_THREAD
  let channel: ServeChannel | null = null
  let stopped = false
  let interruptPending = false
  let generation = 0
  let history: ReturnType<typeof createLocalThreadHistory> | null = null
  let preparing: ReturnType<LivePrepareRewind> | null = null
  const releases: (() => void)[] = []

  const update = (change: Partial<LiveThreadState>) => {
    if (stopped) return
    state = { ...state, ...change }
    args.onChange(state)
  }

  const clearStreams = () => {
    signalTransport.dropAll()
    args.onReset?.()
    update({
      live: false,
      channel: null,
      working: false,
      reported: null,
      titling: false,
      ...RELEASED_FIELDS,
    })
  }

  const wake = async (): Promise<SandboxAttachment> => {
    const result = await args.wake()
    if (result.outcome === EPodConnectOutcome.NotRunning) throw new Error('the pod is not running')
    return { url: result.ticket.url, token: result.ticket.token }
  }

  const handleSignal = (signal: ChannelSignal) => {
    if (channel?.connection().state !== EConnectionView.Connected) return
    if (signal.type === 'chunk' && signal.chunk.type === 'finish' && signal.chunk.usage) {
      update({ reported: signal.chunk.usage })
    }
    if (signal.type === 'events-appended')
      void history?.refresh({ full: false }).catch(() => undefined)
    if (signal.type === 'turn-working') update({ working: signal.working })
    if (isStepSignal(signal) && signalTransport.absorb(signal).opened) args.onStepOpened?.()
    update(absorbInto({ state, signal }))
  }

  const open = ({ result, seed }: { result: PodConnectResult; seed: WireEvent[] }) => {
    let seededAttachment = result.outcome === EPodConnectOutcome.Ready
    let runtimeReload = false
    update({ events: seed })
    const live: ServeChannel = createRemoteDeltaChannel({
      ...args.channelOptions,
      threadId,
      ...(result.outcome === EPodConnectOutcome.Ready
        ? { url: result.ticket.url, token: result.ticket.token }
        : {}),
      readsWake: false,
      lastEventSeq: () => headOf(state.events),
      wakeSandbox: wake,
      maxAttempts: 0,
      scheduleRetry: () => live.failWake({ reason: 'the local session disconnected' }),
    })
    channel = live
    const reads = localThreadReadChannel({ channel: live, available: () => !stopped })
    const createHistory = () =>
      createLocalThreadHistory({
        threadId: args.threadId,
        channel: reads,
        events: () => state.events,
        current: () => !stopped && live.connection().state === EConnectionView.Connected,
        generation: () => generation,
        readFreshSeed: args.readFreshSeed,
        publish: (events) => update(settleInto({ ...state, events })),
      })
    releases.push(
      live.onPendingChanged((pending) => update({ pending })),
      live.subscribe({ threadId, listener: handleSignal }),
      live.onConnection(({ state: view }) => {
        if (view === EConnectionView.Connected) {
          history = createHistory()
          update({ live: true, channel: reads })
          void history
            ?.refresh({ full: !seededAttachment, remote: runtimeReload })
            .catch(() => undefined)
          seededAttachment = false
          runtimeReload = false
          return
        }
        seededAttachment = false
        generation += 1
        clearStreams()
      }),
      live.onReady(({ turnInFlight, transcriptCurrent }) => {
        if (transcriptCurrent === false) {
          seededAttachment = false
          runtimeReload = true
        }
        update({ working: turnInFlight })
      }),
      live.onReload(({ sinceEventSeq }) => {
        seededAttachment = false
        runtimeReload = true
        signalTransport.dropAll()
        args.onReset?.()
        if (live.connection().state !== EConnectionView.Connected) return
        generation += 1
        update(
          settleInto({
            ...state,
            events: keepThrough({ events: state.events, seq: sinceEventSeq }),
          }),
        )
        history = createHistory()
        void history.refresh({ full: true, remote: true }).catch(() => undefined)
      }),
      live.onThreadModelChanged((changed) => args.onModelChanged?.(changed.model)),
      live.onThreadTitling((frame) => {
        if (frame.threadId === threadId) update({ titling: frame.titling })
      }),
      live.onInterruptAck(() => {
        interruptPending = false
      }),
      live.onError(() => {
        if (!interruptPending) return
        interruptPending = false
        args.onInterruptLost?.()
      }),
    )
  }

  const stop = () => {
    generation += 1
    clearStreams()
    update({ pending: [] })
    stopped = true
    for (const release of releases.splice(0)) release()
    channel?.close()
    channel = null
  }

  const start = async () => {
    const [seed, minted] = await Promise.allSettled([
      Promise.resolve().then(args.readSeed),
      Promise.resolve().then(args.mint),
    ])
    if (stopped) return
    open({
      result:
        seed.status === 'fulfilled' && minted.status === 'fulfilled'
          ? minted.value
          : { outcome: EPodConnectOutcome.NotRunning },
      seed: seed.status === 'fulfilled' ? seed.value : [],
    })
  }

  const actions = createLiveThreadActions({
    threadId: args.threadId,
    retained: true,
    liveChannel: () => (stopped ? null : channel),
    onModelChosen: () => undefined,
  })
  const send: LiveSend = (sent) => {
    if (stopped || channel === null) return false
    channel.send(sent)
    return true
  }

  const prepareRewind: LivePrepareRewind = () => {
    if (preparing) return preparing
    preparing = (async () => {
      const roster = await actions.readRoster()
      if (roster === null || history === null) throw new Error('the sandbox is not connected')
      const preparedGeneration = generation
      await history.refresh({ full: true, remote: true })
      if (
        stopped ||
        generation !== preparedGeneration ||
        channel?.connection().state !== EConnectionView.Connected
      ) {
        throw new Error('the sandbox disconnected while preparing rewind')
      }
      return { events: state.events, working: state.working, roster }
    })().finally(() => {
      preparing = null
    })
    return preparing
  }

  return {
    chatTransport: signalTransport.transport,
    start: () => void start(),
    send,
    ...actions,
    prepareRewind,
    interrupt: () => {
      const sent = actions.interrupt()
      if (sent) interruptPending = true
      return sent
    },
    stop,
  }
}
