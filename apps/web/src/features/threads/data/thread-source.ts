import type { StepSignal } from '@dltech/atlas-client/channel'
import type { CallId } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import type { ThreadEvents } from './events-poller'
import type { LiveSend, LiveThreadView } from './live-thread-view'

export type ThreadSource = {
  events: WireEvent[]
  signals: StepSignal[]
  outputs: ReadonlyMap<CallId, string>
  loaded: boolean
  error: Error | null
  working: boolean
  live: boolean
  sendLive: LiveSend
}

const NO_SIGNALS: StepSignal[] = []
const NO_OUTPUTS: ReadonlyMap<CallId, string> = new Map()

export const pollingEnabledFor = (live: LiveThreadView): boolean => !live.live

export function threadSourceOf(args: { live: LiveThreadView; polled: ThreadEvents }): ThreadSource {
  const { live, polled } = args
  if (live.live) {
    return {
      events: live.events,
      signals: live.signals,
      outputs: live.outputs,
      loaded: true,
      error: null,
      working: live.working,
      live: true,
      sendLive: live.send,
    }
  }
  return {
    ...polled,
    signals: NO_SIGNALS,
    outputs: NO_OUTPUTS,
    working: false,
    live: false,
    sendLive: live.send,
  }
}
