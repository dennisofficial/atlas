import { createSignalChatTransport } from '@dltech/atlas-client/chat'
import {
  createRemoteDeltaChannel,
  EClientRequest,
  EConnectionView,
  type ChannelSignal,
  type RemoteDeltaChannel,
  type RemoteDeltaChannelOptions,
  type SandboxAttachment,
} from '@dltech/atlas-client/channel'
import { toThreadId } from '@dltech/atlas-core'
import {
  readEventsReplySchema,
  readThreadReplySchema,
  takeBackPendingReplySchema,
  type WireEvent,
} from '@dltech/atlas-wire/web'

import { appendEvents, headOf, keepThrough } from './live-events'
import { absorbInto, EMPTY_OUTPUTS, isStepSignal, settleInto } from './live-signals'
import { IDLE_LIVE_THREAD, type LiveSend, type LiveThreadState } from './live-thread-view'
import { EPodConnectOutcome, type PodConnectResult } from './pod-connect'

export type LiveChannelOptions = Pick<
  RemoteDeltaChannelOptions,
  'scheduleRetry' | 'scheduleTimeout' | 'scheduleKeepalive' | 'socketFactory' | 'backoffMs'
>

export const MAX_REMINTS = 4
const REMINT_BASE_MS = 500
const REMINT_CEILING_MS = 30_000

export const remintDelayMs = (attempt: number): number =>
  attempt === 0 ? 0 : Math.min(REMINT_CEILING_MS, REMINT_BASE_MS * 2 ** (attempt - 1))

export type LiveThreadControllerArgs = {
  threadId: string
  mint: () => Promise<PodConnectResult>
  readSeed: () => Promise<WireEvent[]>
  onChange: (state: LiveThreadState) => void
  onModelChanged?: (model: { ref: string; effort: string }) => void
  readStoredModel?: () => Promise<{ ref: string; effort: string } | undefined>
  onStepOpened?: () => void
  onReset?: () => void
  channelOptions?: LiveChannelOptions
  scheduleReconnect?: (task: { delayMs: number; run: () => void }) => void
}

export function createLiveThreadController(args: LiveThreadControllerArgs) {
  const threadId = toThreadId(args.threadId)
  const signalTransport = createSignalChatTransport({ now: () => new Date() })
  let state: LiveThreadState = IDLE_LIVE_THREAD
  let channel: RemoteDeltaChannel | null = null
  let stopped = false
  let fellBack = false
  let everConnected = false
  let podGone = false
  let reminted = 0
  let connected = false
  let modelChoices = 0
  let reading = false
  let readAgain = false
  const releases: (() => void)[] = []

  const update = (change: Partial<LiveThreadState>) => {
    if (stopped) return
    state = { ...state, ...change }
    args.onChange(state)
  }

  const release = () => {
    for (const undo of releases.splice(0)) undo()
  }

  const fallBack = () => {
    if (stopped || fellBack) return
    fellBack = true
    release()
    channel?.close()
    signalTransport.dropAll()
    args.onReset?.()
    update({ live: false, working: false, pending: [], reported: null, ...EMPTY_OUTPUTS })
  }

  const commit = (next: LiveThreadState) => {
    if (next !== state) update(next)
  }

  const attachmentOf = async (): Promise<SandboxAttachment> => {
    const minted = await args.mint()
    if (minted.outcome === EPodConnectOutcome.NotRunning) {
      podGone = true
      throw new Error('the pod is not running')
    }
    return { url: minted.ticket.url, token: minted.ticket.token }
  }

  const readFromHead = async (live: RemoteDeltaChannel) => {
    if (reading) {
      readAgain = true
      return
    }
    reading = true
    try {
      do {
        readAgain = false
        const reply = await live.request({
          op: EClientRequest.ReadEvents,
          params: { threadId: args.threadId, fromSeq: headOf(state.events), own: true },
        })
        if (stopped || fellBack) return
        const { events } = readEventsReplySchema.parse(reply)
        commit(
          settleInto({
            ...state,
            events: appendEvents({ current: state.events, incoming: events }),
          }),
        )
      } while (readAgain)
    } catch {
      fallBack()
    } finally {
      reading = false
    }
  }

  const recheckModel = async (live: RemoteDeltaChannel) => {
    const read = args.readStoredModel
    if (read === undefined) return
    try {
      const choicesBefore = modelChoices
      const stored = await read()
      if (stored === undefined) return
      const reply = await live.request({
        op: EClientRequest.ReadThread,
        params: { threadId: args.threadId },
      })
      const podModel = readThreadReplySchema.parse(reply).thread?.model
      if (stopped || fellBack || modelChoices !== choicesBefore || podModel === undefined) return
      if (podModel.ref === stored.ref && podModel.effort === stored.effort) return
      await live.request({
        op: EClientRequest.SetThreadModel,
        params: { threadId: args.threadId, model: stored },
      })
    } catch {
      return
    }
  }

  const handleSignal = (live: RemoteDeltaChannel) => (signal: ChannelSignal) => {
    if (signal.type === 'chunk' && signal.chunk.type === 'finish' && signal.chunk.usage) {
      update({ reported: signal.chunk.usage })
    }
    if (signal.type === 'events-appended') void readFromHead(live)
    if (signal.type === 'turn-working') update({ working: signal.working })
    if (isStepSignal(signal) && signalTransport.absorb(signal).opened) args.onStepOpened?.()
    commit(absorbInto({ state, signal }))
  }

  const scheduleReconnect =
    args.scheduleReconnect ?? (({ delayMs, run }) => void setTimeout(run, delayMs))

  const handleDisconnected = (live: RemoteDeltaChannel) => {
    if (podGone || !everConnected || reminted >= MAX_REMINTS) return fallBack()
    const delayMs = remintDelayMs(reminted)
    reminted += 1
    scheduleReconnect({
      delayMs,
      run: () => {
        if (!stopped && !fellBack) live.reconnect()
      },
    })
  }

  const handleConnection = (live: RemoteDeltaChannel) => {
    const { state: view } = live.connection()
    if (view === EConnectionView.Connected) {
      everConnected = true
      reminted = 0
      update({ live: true })
      if (!connected) void recheckModel(live)
      connected = true
      return
    }
    connected = false
    if (view === EConnectionView.Parked) return fallBack()
    if (view === EConnectionView.Disconnected) handleDisconnected(live)
  }

  const open = (first: SandboxAttachment, seed: WireEvent[]) => {
    update({ events: seed })
    const live = createRemoteDeltaChannel({
      ...args.channelOptions,
      threadId,
      url: first.url,
      token: first.token,
      lastEventSeq: () => headOf(state.events),
      wakeSandbox: attachmentOf,
      maxAttempts: 0,
    })
    channel = live
    update({ pending: live.pendingEntries() })
    releases.push(
      live.onPendingChanged((entries) => update({ pending: entries })),
      live.subscribe({ threadId, listener: handleSignal(live) }),
      live.onConnection(() => handleConnection(live)),
      live.onThreadModelChanged((changed) => args.onModelChanged?.(changed.model)),
      live.onError(() => {
        if (!everConnected) fallBack()
      }),
      live.onReload(({ sinceEventSeq }) => {
        signalTransport.dropAll()
        args.onReset?.()
        commit(
          settleInto({
            ...state,
            events: keepThrough({ events: state.events, seq: sinceEventSeq }),
          }),
        )
        void readFromHead(live)
      }),
    )
  }

  const start = async () => {
    try {
      const seed = await args.readSeed()
      if (stopped) return
      const minted = await args.mint()
      if (stopped) return
      if (minted.outcome === EPodConnectOutcome.NotRunning) return fallBack()
      open({ url: minted.ticket.url, token: minted.ticket.token }, seed)
    } catch {
      fallBack()
    }
  }

  const send: LiveSend = ({ text, requestId }) => {
    if (stopped || fellBack || channel === null) return false
    if (channel.connection().state !== EConnectionView.Connected) return false
    channel.send({ text, requestId })
    return true
  }

  const chooseModel = async (model: { ref: string; effort: string }): Promise<boolean> => {
    const live = channel
    modelChoices += 1
    if (stopped || fellBack || live === null) return false
    if (live.connection().state !== EConnectionView.Connected) return false
    await live.request({
      op: EClientRequest.SetThreadModel,
      params: { threadId: args.threadId, model },
    })
    return true
  }

  const takeBackPending = async (): Promise<string | null> => {
    const live = channel
    if (stopped || fellBack || live === null) throw new Error('the sandbox is not connected')
    const reply = await live.request({
      op: EClientRequest.TakeBackPending,
      params: { threadId: args.threadId },
    })
    return takeBackPendingReplySchema.parse(reply).taken?.text ?? null
  }

  return {
    chatTransport: signalTransport.transport,
    start: () => void start(),
    send,
    chooseModel,
    takeBackPending,
    stop: () => {
      update({ ...EMPTY_OUTPUTS })
      stopped = true
      signalTransport.dropAll()
      release()
      channel?.close()
    },
  }
}
