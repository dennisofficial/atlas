import { ECompactionAnchor } from '../events/body'
import type { Event } from '../events/envelope'
import { compactedThrough } from './watermark'

export type SummariseReach = { anchor: ECompactionAnchor; seq: number; messages: number }

export type SummarisePoint = { upTo: SummariseReach | null; from: SummariseReach | null }

const MESSAGES_WORTH_SUMMARISING_FROM = 2

export function summariseReach(args: {
  point: SummarisePoint
  anchor: ECompactionAnchor
}): SummariseReach | null {
  return args.anchor === ECompactionAnchor.Prefix ? args.point.upTo : args.point.from
}

export function summarisePoints(events: readonly Event[]): ReadonlyMap<string, SummarisePoint> {
  const floor = compactedThrough(events)
  const said = events.filter((event) => event.type === 'user-said' && event.seq > floor)
  const points = new Map<string, SummarisePoint>()

  said.forEach((event, index) => {
    const onward = said.length - index
    const point: SummarisePoint = {
      upTo:
        index === 0
          ? null
          : { anchor: ECompactionAnchor.Prefix, seq: event.seq - 1, messages: index },
      from:
        onward < MESSAGES_WORTH_SUMMARISING_FROM
          ? null
          : { anchor: ECompactionAnchor.Suffix, seq: event.seq, messages: onward },
    }
    if (point.upTo !== null || point.from !== null) points.set(event.id, point)
  })

  return points
}
