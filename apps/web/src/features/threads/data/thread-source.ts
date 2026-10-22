import type { WireEvent } from '@dltech/atlas-wire/web'

import type { ThreadEvents } from './events-poller'
import type { LiveSend, LiveThreadView } from './live-thread-view'

export type ThreadSource = {
  events: WireEvent[]
  loaded: boolean
  error: Error | null
  working: boolean
  live: boolean
  sendLive: LiveSend
}

export const pollingEnabledFor = (live: LiveThreadView): boolean => !live.live

export function threadSourceOf(args: { live: LiveThreadView; polled: ThreadEvents }): ThreadSource {
  const { live, polled } = args
  if (live.live) {
    return {
      events: live.events,
      loaded: true,
      error: null,
      working: live.working,
      live: true,
      sendLive: live.send,
    }
  }
  return { ...polled, working: false, live: false, sendLive: live.send }
}
