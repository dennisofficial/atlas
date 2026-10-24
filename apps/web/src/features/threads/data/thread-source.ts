import type { InFlightStep } from '@dltech/atlas-client/transcript'
import type { CallId, ModelUsage } from '@dltech/atlas-core'
import type { PendingEntryWire, WireEvent } from '@dltech/atlas-wire/web'

import type { ThreadEvents } from './events-poller'
import type {
  LiveChooseModel,
  LiveSend,
  LiveTakeBackPending,
  LiveThreadView,
} from './live-thread-view'

export type ThreadSource = {
  events: WireEvent[]
  steps: InFlightStep[]
  outputs: ReadonlyMap<CallId, string>
  loaded: boolean
  error: Error | null
  working: boolean
  live: boolean
  sendLive: LiveSend
  chooseModel: LiveChooseModel
  pending: readonly PendingEntryWire[]
  reported: ModelUsage | null
  takeBackPending: LiveTakeBackPending
}

const NO_STEPS: InFlightStep[] = []
const NO_PENDING: readonly PendingEntryWire[] = []
const NO_OUTPUTS: ReadonlyMap<CallId, string> = new Map()

export const pollingEnabledFor = (live: LiveThreadView): boolean => !live.live

export function threadSourceOf(args: { live: LiveThreadView; polled: ThreadEvents }): ThreadSource {
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
      sendLive: live.send,
      chooseModel: live.chooseModel,
      pending: live.pending,
      reported: live.reported,
      takeBackPending: live.takeBackPending,
    }
  }
  return {
    ...polled,
    steps: NO_STEPS,
    outputs: NO_OUTPUTS,
    working: false,
    live: false,
    sendLive: live.send,
    chooseModel: live.chooseModel,
    pending: NO_PENDING,
    reported: null,
    takeBackPending: live.takeBackPending,
  }
}
