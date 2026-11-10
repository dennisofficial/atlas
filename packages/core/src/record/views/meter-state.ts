import type { ContextMeter } from '../context-meter'
import type { V2Event, V2EventType } from '../event'
import { stepReadingOf } from './step-reading'

export type MeterEntry = {
  seq: number
  type: V2EventType
  measured: number | null
}

export type MeterState = {
  window: number | null
  used: number | null
  readingSeq: number | null
  summaryAfterReading: boolean
}

export const initialMeterState: MeterState = {
  window: null,
  used: null,
  readingSeq: null,
  summaryAfterReading: false,
}

const measuredOf = (reading: { inputTokens: number; outputTokens: number }): number =>
  Math.max(0, reading.inputTokens) + Math.max(0, reading.outputTokens)

const entryOf = (event: V2Event): MeterEntry => {
  const reading = stepReadingOf(event)
  return {
    seq: event.seq,
    type: event.type,
    measured: reading === undefined ? null : measuredOf(reading),
  }
}

const windowed = (state: MeterState, event: V2Event): MeterState => {
  const window = stepReadingOf(event)?.contextWindow ?? state.window
  return { ...state, window }
}

const withEntry = (state: MeterState, entry: MeterEntry): MeterState => {
  if (entry.measured !== null) {
    return {
      window: state.window,
      used: entry.measured,
      readingSeq: entry.seq,
      summaryAfterReading: false,
    }
  }
  if (entry.type === 'history-summarised') return { ...state, summaryAfterReading: true }
  return state
}

const isEdit = (event: V2Event): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

export const stepMeter = (state: MeterState, event: V2Event): MeterState => {
  const window = stepReadingOf(event)?.contextWindow ?? state.window
  if (isEdit(event)) return { ...initialMeterState, window }
  return withEntry({ ...state, window }, entryOf(event))
}

export const rebuildMeter = (args: {
  state: MeterState
  visibleTail: readonly V2Event[]
}): MeterState =>
  args.visibleTail.reduce((state, event) => withEntry(windowed(state, event), entryOf(event)), {
    ...initialMeterState,
    window: args.state.window,
  })

export const meterOf = (state: MeterState): ContextMeter | null => {
  if (state.window === null && state.readingSeq === null && !state.summaryAfterReading) return null
  const live = state.readingSeq !== null && !state.summaryAfterReading
  return {
    used: live ? state.used : null,
    window: state.window,
    measuredThroughSeq: live ? state.readingSeq : null,
  }
}
