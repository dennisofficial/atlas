import { ECompactionAnchor } from '../events/body'
import type { Event } from '../events/envelope'
import { keptThroughCompaction } from '../compaction/disposition'
import type { SummariseReach } from '../compaction/summarise-points'

export const SUMMARY_REFUSAL_CANNOT = 'That message cannot be summarised'
export const SUMMARY_REFUSAL_NOTHING = 'There is nothing to summarise'
export const SUMMARY_REFUSAL_ALREADY = 'That range is already summarised'
export const SUMMARY_REFUSAL_SPLITS_TOOL = 'That range splits a tool call'

export type SummaryTarget =
  | { ok: true; fromSeq: number; throughSeq: number }
  | { ok: false; reason: string }

type Span = { fromSeq: number; throughSeq: number }

const refused = (reason: string): SummaryTarget => ({ ok: false, reason })

const spansOf = (events: readonly Event[]): Span[] =>
  events.flatMap((event) =>
    event.type === 'history-compacted' && event.anchor === ECompactionAnchor.Prefix
      ? [{ fromSeq: event.fromSeq, throughSeq: event.throughSeq }]
      : [],
  )

const covered = ({ spans, seq }: { spans: readonly Span[]; seq: number }): boolean =>
  spans.some((span) => span.fromSeq <= seq && seq <= span.throughSeq)

const splitsToolCall = ({
  events,
  fromSeq,
  throughSeq,
}: {
  events: readonly Event[]
  fromSeq: number
  throughSeq: number
}): boolean => {
  const sides = new Map<string, Set<boolean>>()
  for (const event of events) {
    if (
      event.type !== 'tool-called' &&
      event.type !== 'tool-result' &&
      event.type !== 'tool-denied'
    ) {
      continue
    }
    const inside = event.seq >= fromSeq && event.seq <= throughSeq
    sides.set(event.callId, (sides.get(event.callId) ?? new Set<boolean>()).add(inside))
  }
  return [...sides.values()].some((seen) => seen.size > 1)
}

export function summaryTargetOf({
  events,
  throughSeq,
}: {
  events: readonly Event[]
  throughSeq: number
}): SummaryTarget {
  const next = events.find((event) => event.seq > throughSeq)
  if (!Number.isInteger(throughSeq) || next?.type !== 'user-said') {
    return refused(SUMMARY_REFUSAL_CANNOT)
  }
  const inside = events.filter((event) => event.seq <= throughSeq)
  if (inside.length === 0) return refused(SUMMARY_REFUSAL_NOTHING)
  const spans = spansOf(events)
  const open = inside.filter((event) => !covered({ spans, seq: event.seq }))
  const content = open.filter(
    (event) => event.type !== 'history-compacted' && !keptThroughCompaction(event.type),
  )
  const first = open[0]
  if (first === undefined || content.length === 0) {
    return refused(open.length < inside.length ? SUMMARY_REFUSAL_ALREADY : SUMMARY_REFUSAL_NOTHING)
  }
  if (splitsToolCall({ events, fromSeq: first.seq, throughSeq })) {
    return refused(SUMMARY_REFUSAL_SPLITS_TOOL)
  }
  return { ok: true, fromSeq: first.seq, throughSeq }
}

export function summaryPointsOf(
  events: readonly { type: string; id: string; seq: number }[],
): ReadonlyMap<string, SummariseReach> {
  const said = events.filter((event) => event.type === 'user-said')
  const points = new Map<string, SummariseReach>()
  said.forEach((event, index) => {
    if (index === 0) return
    points.set(event.id, { throughSeq: event.seq - 1, messages: index })
  })
  return points
}
