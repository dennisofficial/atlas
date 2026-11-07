import { EMeterBasis, meterTokensOf, type ContextMeter } from '../context-meter'
import type { V2Event, V2EventType } from '../event'
import { EMPTY_VISIBILITY, isVisible, stepVisibility, type VisibilityState } from '../visibility'
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
  chunks: readonly (readonly MeterEntry[])[]
  visibility: VisibilityState
  aggregate: Aggregate
}

const CHUNK_SIZE = 256

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
  chunks: [],
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

const appended = (chunks: MeterState['chunks'], entry: MeterEntry): MeterState['chunks'] => {
  const last = chunks[chunks.length - 1]
  if (last === undefined || last.length >= CHUNK_SIZE) return [...chunks, [entry]]
  return [...chunks.slice(0, -1), [...last, entry]]
}

const chunked = (entries: readonly MeterEntry[]): MeterState['chunks'] => {
  const chunks: MeterEntry[][] = []
  for (let index = 0; index < entries.length; index += CHUNK_SIZE) {
    chunks.push(entries.slice(index, index + CHUNK_SIZE))
  }
  return chunks
}

const isEdit = (event: V2Event): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

const windowAfter = (state: MeterState, event: V2Event): number | null =>
  stepReadingOf(event)?.contextWindow ?? state.window

export const stepMeter = (state: MeterState, event: V2Event): MeterState => {
  const entry = entryOf(event)
  const window = windowAfter(state, event)
  const chunks = appended(state.chunks, entry)
  if (!isEdit(event)) {
    return { ...state, window, chunks, aggregate: withEntry(state.aggregate, entry) }
  }
  const visibility = stepVisibility(state.visibility, event)
  const visible = chunks.flat().filter((kept) => isVisible(visibility, kept))
  return { window, chunks, visibility, aggregate: aggregateOf(visible) }
}

export const rebuildMeter = (args: {
  state: MeterState
  visibleTail: readonly V2Event[]
}): MeterState => {
  const entries = args.visibleTail.map(entryOf)
  return {
    window: args.state.window,
    chunks: chunked(entries),
    visibility: args.state.visibility,
    aggregate: aggregateOf(entries),
  }
}

export const meterOf = (state: MeterState): ContextMeter | null => {
  const { aggregate, window } = state
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
