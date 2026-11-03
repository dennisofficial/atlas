import type { Event } from '../events/envelope'
import { compactedThrough } from './watermark'

export type SummariseReach = { throughSeq: number; messages: number }

export function summarisePoints(events: readonly Event[]): ReadonlyMap<string, SummariseReach> {
  const floor = compactedThrough(events)
  const said = events.filter((event) => event.type === 'user-said' && event.seq > floor)
  const points = new Map<string, SummariseReach>()

  said.forEach((event, index) => {
    if (index === 0) return
    points.set(event.id, { throughSeq: event.seq - 1, messages: index })
  })

  return points
}
