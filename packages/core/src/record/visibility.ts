import { KEPT_THROUGH_COMPACTION } from '../compaction/disposition'
import type { V2Event, V2EventType } from './event'

export type HiddenSpan = {
  createdAt: number
  fromSeq: number
  throughSeq: number
  keepSurvivors: boolean
}

export type VisibilityState = { spans: HiddenSpan[] }

export type VisibleSegment = { fromSeq: number; throughSeq: number; onlyTypes?: V2EventType[] }

export const EMPTY_VISIBILITY: VisibilityState = { spans: [] }

const SURVIVOR_TYPES: readonly V2EventType[] = KEPT_THROUGH_COMPACTION

export function stepVisibility(state: VisibilityState, event: V2Event): VisibilityState {
  if (event.type === 'history-rewound') {
    const kept = state.spans.filter((span) => span.createdAt <= event.toSeq)
    const span = {
      createdAt: event.seq,
      fromSeq: event.toSeq + 1,
      throughSeq: event.seq,
      keepSurvivors: false,
    }
    return { spans: [...kept, span] }
  }
  if (event.type === 'history-summarised') {
    const span = {
      createdAt: event.seq,
      fromSeq: event.fromSeq,
      throughSeq: event.throughSeq,
      keepSurvivors: true,
    }
    return { spans: [...state.spans, span] }
  }
  return state
}

const covers = (params: { span: HiddenSpan; seq: number }): boolean =>
  params.span.fromSeq <= params.seq && params.seq <= params.span.throughSeq

export const isVisible = (state: VisibilityState, event: V2Event): boolean =>
  !state.spans.some(
    (span) =>
      covers({ span, seq: event.seq }) &&
      !(span.keepSurvivors && SURVIVOR_TYPES.includes(event.type)),
  )

export function visibleSegments(params: {
  state: VisibilityState
  fromSeq: number
  throughSeq: number
}): VisibleSegment[] {
  const { state, fromSeq, throughSeq } = params
  if (fromSeq > throughSeq) return []
  const clip = (seq: number): number => Math.min(Math.max(seq, fromSeq), throughSeq + 1)
  const cuts = new Set([fromSeq, throughSeq + 1])
  for (const span of state.spans) {
    cuts.add(clip(span.fromSeq))
    cuts.add(clip(span.throughSeq + 1))
  }
  const points = [...cuts].sort((left, right) => left - right)

  const segments: VisibleSegment[] = []
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index] as number
    const end = (points[index + 1] as number) - 1
    const covering = state.spans.filter((span) => covers({ span, seq: start }))
    if (covering.some((span) => !span.keepSurvivors)) continue
    const onlySurvivors = covering.length > 0
    const last = segments[segments.length - 1]
    if (
      last !== undefined &&
      last.throughSeq === start - 1 &&
      (last.onlyTypes !== undefined) === onlySurvivors
    ) {
      last.throughSeq = end
      continue
    }
    segments.push(
      onlySurvivors
        ? { fromSeq: start, throughSeq: end, onlyTypes: SURVIVOR_TYPES.slice() }
        : { fromSeq: start, throughSeq: end },
    )
  }
  return segments
}

export function visibleEvents(events: readonly V2Event[]): V2Event[] {
  const state = events.reduce(stepVisibility, EMPTY_VISIBILITY)
  return events.filter((event) => isVisible(state, event))
}
