import type { WireEvent } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'

export type ThreadEvents = { events: WireEvent[]; loaded: boolean; error: Error | null }

export const INITIAL_THREAD_EVENTS: ThreadEvents = { events: [], loaded: false, error: null }

export function createEventsReader(args: {
  threadId: string
  fetchEvents: (threadId: string) => Promise<WireEvent[]>
  onUpdate: (update: (current: ThreadEvents) => ThreadEvents) => void
}) {
  let stopped = false
  let readHead: number | null = null
  let wantedHead: number | null = null

  const runner = createCoalescedRunner({
    run: async () => {
      const target = wantedHead
      try {
        const events = await args.fetchEvents(args.threadId)
        if (stopped) return
        readHead = target
        args.onUpdate(() => ({ events, loaded: true, error: null }))
      } catch (failure) {
        if (stopped) return
        if (wantedHead === target) wantedHead = readHead
        const error = failure instanceof Error ? failure : new Error(String(failure))
        args.onUpdate((current) => ({ ...current, error }))
      }
    },
  })

  const handleHead = (head: number) => {
    if (stopped || head === wantedHead) return
    wantedHead = head
    runner.trigger()
  }

  return {
    start: runner.trigger,
    poke: runner.trigger,
    handleHead,
    stop: () => {
      stopped = true
      runner.stop()
    },
  }
}
