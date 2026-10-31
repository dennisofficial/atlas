import type { WireEvent } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'
import { appendEvents, headOf, keepThrough } from './live-events'

export type ThreadEvents = { events: WireEvent[]; loaded: boolean; error: Error | null }

export const INITIAL_THREAD_EVENTS: ThreadEvents = { events: [], loaded: false, error: null }

export type EventsFetcher = (args: {
  threadId: string
  fromSeq?: number | undefined
}) => Promise<WireEvent[]>

export function createEventsReader(args: {
  threadId: string
  fetchSeed: () => Promise<WireEvent[]>
  fetchEvents: EventsFetcher
  onUpdate: (update: (current: ThreadEvents) => ThreadEvents) => void
}) {
  let stopped = false
  let readHead: number | null = null
  let wantedHead: number | null = null
  let seeded = false
  let held: WireEvent[] = []

  const publish = (events: WireEvent[], target: number | null) => {
    held = events
    readHead = target
    args.onUpdate(() => ({ events, loaded: true, error: null }))
  }

  const runner = createCoalescedRunner({
    run: async () => {
      const target = wantedHead
      try {
        if (!seeded) {
          const seed = await args.fetchSeed()
          if (stopped) return
          seeded = true
          publish(seed, target)
          if (target !== null && target > headOf(seed)) runner.trigger()
          return
        }
        const floorEvent = held.at(-1)
        const floor = floorEvent?.seq ?? 0
        const delta = await args.fetchEvents({ threadId: args.threadId, fromSeq: floor })
        if (stopped) return
        const retracted = delta.some(
          (incoming) =>
            incoming.seq <= floor &&
            held.find((event) => event.seq === incoming.seq)?.id !== incoming.id,
        )
        const fresh = delta.filter((event) => event.seq > floor)
        const contiguous = fresh.every((event, index) => event.seq === floor + index + 1)
        const merged = appendEvents({ current: held, incoming: delta })
        const short = target !== null && target > headOf(merged)
        if (retracted || !contiguous || short) {
          const events = await args.fetchEvents({ threadId: args.threadId })
          if (stopped) return
          publish(events, target)
          return
        }
        publish(merged, target)
      } catch (failure) {
        if (stopped) return
        if (wantedHead === target) wantedHead = readHead
        const error = failure instanceof Error ? failure : new Error(String(failure))
        args.onUpdate((current) => ({ ...current, error }))
      }
    },
  })

  const handleHead = (head: number) => {
    if (stopped) return
    if (readHead !== null && head < readHead && seeded) {
      publish(keepThrough({ events: held, seq: head }), head)
      if (wantedHead !== null && wantedHead <= head) wantedHead = readHead
      return
    }
    if (head === wantedHead) return
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
