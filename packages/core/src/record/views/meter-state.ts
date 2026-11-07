import { EMeterBasis, meterTokensOf, type ContextMeter } from '../context-meter'
import type { V2Event, V2EventType } from '../event'
import { EMPTY_VISIBILITY, stepVisibility, type VisibilityState } from '../visibility'
import { stepReadingOf } from './step-reading'

export type MeterEntry = {
  seq: number
  type: V2EventType
  tokens: number
  measured: number | null
}

type Aggregate = {
  total: number
  readingSeq: number | null
  measured: number
  sinceReading: number
  leadingToolCalls: boolean
  summaryAfterReading: boolean
}

export type MeterState = {
  window: number | null
  visibility: VisibilityState
  aggregate: Aggregate | null
}

const EMPTY_AGGREGATE: Aggregate = {
  total: 0,
  readingSeq: null,
  measured: 0,
  sinceReading: 0,
  leadingToolCalls: false,
  summaryAfterReading: false,
}

export const initialMeterState: MeterState = {
  window: null,
  visibility: EMPTY_VISIBILITY,
  aggregate: EMPTY_AGGREGATE,
}

const entryOf = (event: V2Event): MeterEntry => {
  const reading = stepReadingOf(event)
  return {
    seq: event.seq,
    type: event.type,
    tokens: meterTokensOf(event),
    measured:
      reading === undefined
        ? null
        : Math.max(0, reading.inputTokens) + Math.max(0, reading.outputTokens),
  }
}

const withEntry = (aggregate: Aggregate, entry: MeterEntry): Aggregate => {
  const total = aggregate.total + entry.tokens
  const summaryAfterReading = entry.type === 'history-summarised' || aggregate.summaryAfterReading
  if (entry.measured !== null) {
    return {
      total,
      readingSeq: entry.seq,
      measured: entry.measured,
      sinceReading: 0,
      leadingToolCalls: true,
      summaryAfterReading: false,
    }
  }
  if (aggregate.readingSeq === null) return { ...aggregate, total, summaryAfterReading }
  if (aggregate.leadingToolCalls && entry.type === 'tool-called') return { ...aggregate, total }
  return {
    ...aggregate,
    total,
    sinceReading: aggregate.sinceReading + entry.tokens,
    leadingToolCalls: false,
    summaryAfterReading,
  }
}

const aggregateOf = (entries: readonly MeterEntry[]): Aggregate =>
  entries.reduce(withEntry, EMPTY_AGGREGATE)

const isEdit = (event: V2Event): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

export const stepMeter = (state: MeterState, event: V2Event): MeterState => {
  const window = stepReadingOf(event)?.contextWindow ?? state.window
  if (isEdit(event)) {
    return { window, visibility: stepVisibility(state.visibility, event), aggregate: null }
  }
  if (state.aggregate === null) return { ...state, window }
  return { ...state, window, aggregate: withEntry(state.aggregate, entryOf(event)) }
}

export const rebuildMeter = (args: {
  state: MeterState
  visibleTail: readonly V2Event[]
}): MeterState => ({
  window: args.state.window,
  visibility: args.state.visibility,
  aggregate: aggregateOf(args.visibleTail.map(entryOf)),
})

export const meterOf = (state: MeterState): ContextMeter | null => {
  const { aggregate, window } = state
  if (aggregate === null) return null
  if (aggregate.readingSeq === null && aggregate.total === 0 && window === null) return null
  if (aggregate.readingSeq === null || aggregate.summaryAfterReading) {
    return {
      used: aggregate.total,
      window,
      basis: EMeterBasis.Estimated,
      measuredThroughSeq: null,
      estimatedTokens: aggregate.total,
    }
  }
  return {
    used: aggregate.measured + aggregate.sinceReading,
    window,
    basis: EMeterBasis.Measured,
    measuredThroughSeq: aggregate.readingSeq,
    estimatedTokens: aggregate.sinceReading,
  }
}
