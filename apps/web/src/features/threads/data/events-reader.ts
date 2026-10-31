import type { WireEvent } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'
import { appendEvents, headOf } from './live-events'

export type ThreadEvents = { events: WireEvent[]; loaded: boolean; error: Error | null }

export const INITIAL_THREAD_EVENTS: ThreadEvents = { events: [], loaded: false, error: null }

export type EventsFetcher = (args: {
  threadId: string
  fromSeq?: number | undefined
}) => Promise<WireEvent[]>

export function createEventsReader(args: {
  threadId: string
  localCopy?: boolean
  fetchSeed: () => Promise<WireEvent[]>
  fetchEvents: EventsFetcher
  onUpdate: (update: (current: ThreadEvents) => ThreadEvents) => void
}) {
  let stopped = false
  let wantedHead: number | null = null
  let generation = 0
  let fullReadRequired = false
  let seeded = false
  let held: WireEvent[] = []

  const publish = (events: WireEvent[]) => {
    held = events
    args.onUpdate(() => ({ events, loaded: true, error: null }))
  }

  const runner = createCoalescedRunner({
    run: async () => {
      const target = wantedHead
      const readGeneration = generation
      const superseded = () => stopped || readGeneration !== generation
      try {
        if (fullReadRequired) {
          const events = await args.fetchEvents({ threadId: args.threadId })
          if (superseded()) return
          seeded = true
          fullReadRequired = false
          publish(events)
          return
        }
        if (!seeded) {
          const seed = await args.fetchSeed()
          if (superseded()) return
          seeded = true
          if (wantedHead !== null && headOf(seed) > wantedHead) {
            fullReadRequired = true
            runner.trigger()
            return
          }
          publish(seed)
          if (wantedHead !== null && wantedHead > headOf(seed)) runner.trigger()
          return
        }
        const floor = held.at(-1)?.seq ?? 0
        const delta = await args.fetchEvents({ threadId: args.threadId, fromSeq: floor })
        if (superseded()) return
        const retracted = delta.some(
          (incoming) =>
            incoming.seq <= floor &&
            held.find((event) => event.seq === incoming.seq)?.id !== incoming.id,
        )
        const missingAnchor = held.length > 0 && !delta.some((event) => event.seq === floor)
        const fresh = delta.filter((event) => event.seq > floor)
        const contiguous =
          args.localCopy || fresh.every((event, index) => event.seq === floor + index + 1)
        const merged = appendEvents({ current: held, incoming: delta })
        const short = target !== null && target > headOf(merged)
        if (missingAnchor || retracted || !contiguous || short) {
          const events = await args.fetchEvents({ threadId: args.threadId })
          if (superseded()) return
          publish(events)
          return
        }
        publish(merged)
      } catch (failure) {
        if (superseded()) return
        if (wantedHead === target) wantedHead = null
        const error = failure instanceof Error ? failure : new Error(String(failure))
        args.onUpdate((current) => ({ ...current, error }))
      }
    },
  })

  const handleHead = (head: number) => {
    if (stopped || head === wantedHead) return
    if ((wantedHead !== null && head < wantedHead) || head < headOf(held)) {
      generation += 1
      fullReadRequired = true
    }
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
