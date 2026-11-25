import { KEPT_THROUGH_COMPACTION } from '../compaction/disposition'
import { isDurable } from './durability'
import type { RecordEvent, RecordEventType } from './event'

export type HiddenSpan = {
  createdAt: number
  fromSeq: number
  throughSeq: number
  keepSurvivors: boolean
  keepTurns: boolean
}

export type VisibilityState = { spans: HiddenSpan[] }

export type VisibleSegment = { fromSeq: number; throughSeq: number; onlyTypes?: RecordEventType[] }

export const EMPTY_VISIBILITY: VisibilityState = { spans: [] }

const SURVIVOR_TYPES: readonly RecordEventType[] = KEPT_THROUGH_COMPACTION

const TURN_END_TYPES: readonly RecordEventType[] = ['turn-ended']

export function stepVisibility(state: VisibilityState, event: RecordEvent): VisibilityState {
  if (event.type === 'history-rewound') {
    const kept = state.spans.filter((span) => span.createdAt <= event.toSeq)
    const span = {
      createdAt: event.seq,
      fromSeq: event.toSeq + 1,
      throughSeq: event.seq,
      keepSurvivors: false,
      keepTurns: true,
    }
    return { spans: [...kept, span] }
  }
  if (event.type === 'history-summarised') {
    const span = {
      createdAt: event.seq,
      fromSeq: event.fromSeq,
      throughSeq: event.throughSeq,
      keepSurvivors: true,
      keepTurns: false,
    }
    return { spans: [...state.spans, span] }
  }
  return state
}

const covers = (params: { span: HiddenSpan; seq: number }): boolean =>
  params.span.fromSeq <= params.seq && params.seq <= params.span.throughSeq

const keptTypesOf = (span: HiddenSpan): readonly RecordEventType[] => {
  const survivors = span.keepSurvivors ? SURVIVOR_TYPES : []
  const turns = span.keepTurns ? TURN_END_TYPES : []
  return [...survivors, ...turns]
}

const keptBy = (params: { span: HiddenSpan; type: RecordEventType }): boolean =>
  (params.span.keepSurvivors && SURVIVOR_TYPES.includes(params.type)) ||
  (params.span.keepTurns && TURN_END_TYPES.includes(params.type))

export const isVisible = (
  state: VisibilityState,
  event: Pick<RecordEvent, 'seq' | 'type'>,
): boolean =>
  !state.spans.some(
    (span) => covers({ span, seq: event.seq }) && !keptBy({ span, type: event.type }),
  )

export const isSurviving = (
  state: VisibilityState,
  event: Pick<RecordEvent, 'seq' | 'type'>,
): boolean => !state.spans.some((span) => !span.keepSurvivors && covers({ span, seq: event.seq }))

const intersectTypes = (lists: readonly (readonly RecordEventType[])[]): RecordEventType[] => {
  const [first, ...rest] = lists
  if (first === undefined) return []
  return first.filter((type) => rest.every((list) => list.includes(type)))
}

const sameTypes = (
  left: readonly RecordEventType[] | undefined,
  right: readonly RecordEventType[] | undefined,
): boolean => {
  if (left === undefined || right === undefined) return left === right
  return left.length === right.length && left.every((type) => right.includes(type))
}

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
    const kept = covering.map(keptTypesOf)
    if (kept.some((types) => types.length === 0)) continue
    const onlyTypes = kept.length === 0 ? undefined : intersectTypes(kept)
    if (onlyTypes !== undefined && onlyTypes.length === 0) continue
    const last = segments[segments.length - 1]
    if (
      last !== undefined &&
      last.throughSeq === start - 1 &&
      sameTypes(last.onlyTypes, onlyTypes)
    ) {
      last.throughSeq = end
      continue
    }
    segments.push(
      onlyTypes === undefined
        ? { fromSeq: start, throughSeq: end }
        : { fromSeq: start, throughSeq: end, onlyTypes },
    )
  }
  return segments
}

const turnStartSeqs = (events: readonly RecordEvent[]): ReadonlyMap<number, number> => {
  const open = new Map<string, number>()
  const starts = new Map<number, number>()
  for (const event of events) {
    if (event.type === 'turn-started') open.set(event.turnId, event.seq)
    if (event.type === 'turn-ended') {
      const start = open.get(event.turnId)
      if (start !== undefined) starts.set(event.seq, start)
    }
  }
  return starts
}

export function visibleWithin(params: {
  state: VisibilityState
  events: readonly RecordEvent[]
}): RecordEvent[] {
  const starts = turnStartSeqs(params.events)
  return params.events.filter((event) => {
    if (!isVisible(params.state, event)) return false
    if (event.type !== 'turn-ended') return true
    const start = starts.get(event.seq)
    if (start === undefined) return true
    return isVisible(params.state, { seq: start, type: 'turn-started' })
  })
}

export function visibleEvents(events: readonly RecordEvent[]): RecordEvent[] {
  return visibleWithin({ state: events.reduce(stepVisibility, EMPTY_VISIBILITY), events })
}

export const isFoldable = (
  state: VisibilityState,
  event: Pick<RecordEvent, 'seq' | 'type'>,
): boolean => isDurable(event.type) || isVisible(state, event)

export function foldableEvents(events: readonly RecordEvent[]): RecordEvent[] {
  const state = events.reduce(stepVisibility, EMPTY_VISIBILITY)
  return events.filter((event) => isFoldable(state, event))
}
