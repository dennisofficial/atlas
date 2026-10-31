import type { InFlightStep } from '@dltech/atlas-client/transcript'
import type { CallId, ModelUsage } from '@dltech/atlas-core'
import type { OperatorInputRequestWire, PendingEntryWire, WireEvent } from '@dltech/atlas-wire/web'

import type { PolledThreadEvents } from './use-thread-events'
import type {
  LiveApplyRewind,
  LiveChooseModel,
  LiveDismissFailure,
  LiveInterrupt,
  LivePrepareRewind,
  LiveRetry,
  LiveReadRoster,
  LiveSend,
  LiveTakeBackPending,
  LiveThreadView,
  ServeChannel,
} from './live-thread-view'

export type ThreadSource = {
  events: WireEvent[]
  steps: InFlightStep[]
  outputs: ReadonlyMap<CallId, string>
  loaded: boolean
  error: Error | null
  working: boolean
  live: boolean
  channel: ServeChannel | null
  sendLive: LiveSend
  chooseModel: LiveChooseModel
  pending: readonly PendingEntryWire[]
  reported: ModelUsage | null
  operatorInput: OperatorInputRequestWire | null
  titling: boolean
  liveTitle: string | null
  waitingOnOperator: boolean
  takeBackPending: LiveTakeBackPending
  interrupt: LiveInterrupt
  retry: LiveRetry
  dismissFailure: LiveDismissFailure
  applyRewind: LiveApplyRewind
  readRoster: LiveReadRoster
  prepareRewind?: LivePrepareRewind | undefined
  refreshEvents: () => void
}

const NO_STEPS: InFlightStep[] = []
const NO_PENDING: readonly PendingEntryWire[] = []
const NO_OUTPUTS: ReadonlyMap<CallId, string> = new Map()
const STREAMED = () => undefined

export const pollingEnabledFor = (live: LiveThreadView): boolean => !live.live

export function threadSourceOf(args: {
  live: LiveThreadView
  polled: PolledThreadEvents
}): ThreadSource {
  const { live, polled } = args
  if (live.live) {
    return {
      events: live.events,
      steps: live.steps,
      outputs: live.outputs,
      loaded: true,
      error: null,
      working: live.working,
      live: true,
      channel: live.channel,
      sendLive: live.send,
      chooseModel: live.chooseModel,
      pending: live.pending,
      reported: live.reported,
      operatorInput: live.operatorInput,
      titling: live.titling,
      liveTitle: live.liveTitle,
      waitingOnOperator: live.operatorInput !== null,
      takeBackPending: live.takeBackPending,
      interrupt: live.interrupt,
      retry: live.retry,
      dismissFailure: live.dismissFailure,
      applyRewind: live.applyRewind,
      readRoster: live.readRoster,
      prepareRewind: live.prepareRewind,
      refreshEvents: STREAMED,
    }
  }
  const { poke, ...events } = polled
  return {
    ...events,
    refreshEvents: poke,
    steps: NO_STEPS,
    outputs: NO_OUTPUTS,
    working: false,
    live: false,
    channel: null,
    sendLive: live.send,
    chooseModel: live.chooseModel,
    pending: NO_PENDING,
    reported: null,
    operatorInput: null,
    titling: false,
    liveTitle: live.liveTitle,
    waitingOnOperator: false,
    takeBackPending: live.takeBackPending,
    interrupt: live.interrupt,
    retry: live.retry,
    dismissFailure: live.dismissFailure,
    applyRewind: live.applyRewind,
    readRoster: live.readRoster,
    prepareRewind: live.prepareRewind,
  }
}
