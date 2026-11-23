import type { Event } from '@dltech/atlas-core'

type SummaryEvent = Event & { type: 'history-compacted' }

const targetOf = (args: {
  event: SummaryEvent
  others: readonly Event[]
  ownIndex: number
}): number => {
  const found = args.others.findIndex((other) => other.seq > args.event.throughSeq)
  const target = found === -1 ? args.others.length : found
  return Math.min(target, args.ownIndex)
}

export function summariesAtTarget(events: readonly Event[]): Event[] {
  const summaries = new Map<number, SummaryEvent[]>()
  const others: Event[] = []
  for (const event of events) {
    if (event.type !== 'history-compacted') {
      others.push(event)
      continue
    }
    const target = targetOf({ event, others, ownIndex: others.length })
    const placed = summaries.get(target) ?? []
    placed.push(event)
    summaries.set(target, placed)
  }

  const ordered: Event[] = []
  others.forEach((event, index) => {
    ordered.push(...(summaries.get(index) ?? []), event)
  })
  ordered.push(...(summaries.get(others.length) ?? []))
  return ordered
}
