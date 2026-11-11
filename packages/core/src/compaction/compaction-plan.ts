import type { Event } from '../events/envelope'
import { compactionTarget } from './compaction-target'
import { compactedThrough } from './watermark'

export type CompactionPlan = {
  throughSeq: number
  compactedEvents: number
  keptEvents: number
}

function candidateWatermarks({ events }: { events: readonly Event[] }): readonly number[] {
  const already = compactedThrough(events)

  return events
    .filter((event) => event.type === 'user-said' && event.seq - 1 > already)
    .map((event) => event.seq - 1)
    .reverse()
}

export function planCompaction({
  events,
}: {
  events: readonly Event[]
}): CompactionPlan | undefined {
  const throughSeq = candidateWatermarks({ events }).find(
    (candidate) => compactionTarget({ events, throughSeq: candidate }).allowed,
  )
  if (throughSeq === undefined) return undefined

  const compactedEvents = events.filter((event) => event.seq <= throughSeq).length

  return {
    throughSeq,
    compactedEvents,
    keptEvents: events.length - compactedEvents,
  }
}
