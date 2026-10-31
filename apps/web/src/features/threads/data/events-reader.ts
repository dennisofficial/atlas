import type { WireEvent } from '@dltech/atlas-wire/web'

import { createCoalescedRunner } from './coalesced-runner'
import {
  eventsSnapshot,
  type EventsBatch,
  type EventsCheckpoint,
  type EventsSnapshot,
  type SnapshotFetcher,
} from './events-snapshot'
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
  fetchSeed: () => Promise<WireEvent[] | EventsSnapshot>
  fetchEvents: EventsFetcher
  fetchSnapshot?: SnapshotFetcher | undefined
  onAccept?: (snapshot: EventsSnapshot) => void
  onUpdate: (update: (current: ThreadEvents) => ThreadEvents) => void
}) {
  let stopped = false
  let wantedHead: number | null = null
  let wantedRev: number | undefined
  let acceptedRev: number | undefined
  let generation = 0
  let fullReadRequired = false
  let needsRead = false
  let seeded = false
  let pokedDuringSeed = false
  let floor = 0
  let held: WireEvent[] = []
  let buffered: EventsBatch[] = []
  let resetKey: string | undefined

  const publish = (snapshot: EventsSnapshot) => {
    held = snapshot.events
    floor = snapshot.head
    acceptedRev = snapshot.historyRev
    args.onAccept?.(snapshot)
    args.onUpdate(() => ({ events: held, loaded: true, error: null }))
  }
  const requireFull = () => {
    fullReadRequired = true
    needsRead = true
    runner.trigger()
  }
  const coherent = (snapshot: EventsSnapshot) => {
    if (wantedRev !== undefined && snapshot.historyRev !== wantedRev) {
      if (snapshot.historyRev === undefined || snapshot.historyRev < wantedRev) {
        requireFull()
        return false
      }
    }
    if (snapshot.historyRev !== undefined) wantedRev = snapshot.historyRev
    return true
  }
  const mergeBatch = (batch: EventsBatch): boolean => {
    if (batch.historyRev !== acceptedRev) return false
    const fresh = batch.events.filter((event) => event.seq > floor)
    if (batch.head <= floor) return true
    if (batch.fromSeq > floor + 1 || fresh.length === 0) return false
    if (!fresh.every((event, index) => event.seq === floor + index + 1)) return false
    const head = headOf(fresh)
    if (head !== batch.head) return false
    publish({
      events: appendEvents({ current: held, incoming: fresh }),
      head,
      ...(acceptedRev === undefined ? {} : { historyRev: acceptedRev }),
    })
    return true
  }
  const drain = () => {
    const batches = buffered
    buffered = []
    for (const batch of batches) {
      if (batch.historyRev !== undefined && wantedRev !== undefined && batch.historyRev < wantedRev)
        continue
      if (!mergeBatch(batch)) needsRead = true
    }
    if (needsRead) runner.trigger()
  }
  const fetchRows = async (fromSeq?: number): Promise<EventsSnapshot> =>
    args.fetchSnapshot
      ? args.fetchSnapshot({ threadId: args.threadId, fromSeq })
      : eventsSnapshot(await args.fetchEvents({ threadId: args.threadId, fromSeq }))

  const runner = createCoalescedRunner({
    run: async () => {
      if (seeded && !needsRead && !fullReadRequired) return
      needsRead = false
      const target = wantedHead
      const readGeneration = generation
      const superseded = () => stopped || readGeneration !== generation
      try {
        if (fullReadRequired || !seeded) {
          const initial = !fullReadRequired
          const snapshot = initial ? eventsSnapshot(await args.fetchSeed()) : await fetchRows()
          if (
            stopped ||
            (readGeneration !== generation &&
              (snapshot.historyRev === undefined || snapshot.historyRev !== wantedRev))
          )
            return
          if (!coherent(snapshot)) return
          seeded = true
          if (
            snapshot.historyRev === undefined &&
            wantedHead !== null &&
            snapshot.head > wantedHead
          ) {
            requireFull()
            return
          }
          fullReadRequired = false
          publish(snapshot)
          needsRead = pokedDuringSeed
          pokedDuringSeed = false
          drain()
          if (initial && wantedHead !== null && wantedHead > floor) {
            needsRead = true
            runner.trigger()
          }
          return
        }
        const anchor = floor
        const snapshot = await fetchRows(anchor)
        if (superseded() || !coherent(snapshot)) return
        if (snapshot.historyRev !== acceptedRev) {
          requireFull()
          return
        }
        const delta = snapshot.events
        const retracted = delta.some(
          (incoming) =>
            incoming.seq <= anchor &&
            held.find((event) => event.seq === incoming.seq)?.id !== incoming.id,
        )
        const missingAnchor =
          held.some((event) => event.seq === anchor) && !delta.some((event) => event.seq === anchor)
        const fresh = delta.filter((event) => event.seq > anchor)
        const contiguous =
          args.localCopy || fresh.every((event, index) => event.seq === anchor + index + 1)
        const merged = appendEvents({ current: held, incoming: delta })
        const logicalHead =
          snapshot.historyRev === undefined ? headOf(merged) : Math.max(floor, snapshot.head)
        const short =
          (target !== null && target > logicalHead) ||
          (snapshot.historyRev !== undefined &&
            snapshot.head > anchor &&
            headOf(fresh) !== snapshot.head)
        if (missingAnchor || retracted || !contiguous || short) {
          const replacement = await fetchRows()
          if (superseded() || !coherent(replacement)) return
          publish(replacement)
          drain()
          return
        }
        publish({ ...snapshot, events: merged, head: logicalHead })
        drain()
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
      buffered = []
    }
    wantedHead = head
    needsRead = true
    runner.trigger()
  }
  const handleCheckpoint = (checkpoint: EventsCheckpoint) => {
    if (stopped) return
    if (checkpoint.historyRev === undefined) return handleHead(checkpoint.head)
    if (wantedRev !== undefined && checkpoint.historyRev < wantedRev) return
    if (wantedRev !== undefined && checkpoint.historyRev > wantedRev) {
      generation += 1
      buffered = []
      fullReadRequired = true
    }
    wantedRev = checkpoint.historyRev
    wantedHead = checkpoint.head
    if (seeded && acceptedRev !== wantedRev) fullReadRequired = true
    if (!seeded || fullReadRequired || checkpoint.head > floor) {
      needsRead = true
      runner.trigger()
    }
  }
  const handleReset = (checkpoint: EventsCheckpoint) => {
    if (
      stopped ||
      (checkpoint.historyRev !== undefined &&
        wantedRev !== undefined &&
        checkpoint.historyRev < wantedRev)
    )
      return
    const key = `${checkpoint.historyRev}:${checkpoint.head}`
    if (resetKey === key) return
    resetKey = key
    generation += 1
    buffered = []
    wantedRev = checkpoint.historyRev
    wantedHead = checkpoint.head
    requireFull()
  }
  const handleEvents = (batch: EventsBatch) => {
    if (
      stopped ||
      (batch.historyRev !== undefined && wantedRev !== undefined && batch.historyRev < wantedRev)
    )
      return
    if (batch.historyRev !== undefined && wantedRev !== undefined && batch.historyRev > wantedRev) {
      handleReset(batch)
    }
    if (batch.historyRev !== undefined) wantedRev = batch.historyRev
    wantedHead = Math.max(wantedHead ?? 0, batch.head)
    if (!seeded || fullReadRequired) {
      buffered.push(batch)
      if (!seeded) runner.trigger()
      return
    }
    if (!mergeBatch(batch)) {
      needsRead = true
      runner.trigger()
    }
  }

  return {
    start: runner.trigger,
    poke: () => {
      if (!seeded) pokedDuringSeed = true
      needsRead = true
      runner.trigger()
    },
    handleHead,
    handleCheckpoint,
    handleEvents,
    handleReset,
    stop: () => {
      stopped = true
      runner.stop()
    },
  }
}
