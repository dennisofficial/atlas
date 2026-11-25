import type { ContextPart } from '../../assembly/context-breakdown'
import type { ContextMeter } from '../context-meter'
import type { RecordEvent, RecordEventType } from '../event'
import { stepReadingOf } from './step-reading'

export type MeterEntry = {
  seq: number
  type: RecordEventType
  measured: number | null
  breakdown: readonly ContextPart[] | null
}

export type MeterState = {
  window: number | null
  used: number | null
  readingSeq: number | null
  breakdown: readonly ContextPart[] | null
  summaryAfterReading: boolean
}

export const initialMeterState: MeterState = {
  window: null,
  used: null,
  readingSeq: null,
  breakdown: null,
  summaryAfterReading: false,
}

const measuredOf = (reading: { inputTokens: number; outputTokens: number }): number =>
  Math.max(0, reading.inputTokens) + Math.max(0, reading.outputTokens)

const entryOf = (event: RecordEvent): MeterEntry => {
  const reading = stepReadingOf(event)
  return {
    seq: event.seq,
    type: event.type,
    measured: reading === undefined ? null : measuredOf(reading),
    breakdown: reading?.breakdown ?? null,
  }
}

const withEntry = (state: MeterState, entry: MeterEntry): MeterState => {
  if (entry.type === 'rotated') {
    return {
      window: state.window,
      used: null,
      readingSeq: null,
      breakdown: null,
      summaryAfterReading: false,
    }
  }
  if (entry.measured !== null) {
    return {
      window: state.window,
      used: entry.measured,
      readingSeq: entry.seq,
      breakdown: entry.breakdown,
      summaryAfterReading: false,
    }
  }
  if (entry.type === 'history-summarised') return { ...state, summaryAfterReading: true }
  return state
}

const isEdit = (event: RecordEvent): boolean =>
  event.type === 'history-rewound' ||
  event.type === 'history-summarised' ||
  event.type === 'rotated'

export const stepMeter = (state: MeterState, event: RecordEvent): MeterState => {
  const window = stepReadingOf(event)?.contextWindow ?? state.window
  if (isEdit(event)) return { ...initialMeterState, window }
  return withEntry({ ...state, window }, entryOf(event))
}

export const rebuildMeter = (args: {
  state: MeterState
  visibleTail: readonly RecordEvent[]
}): MeterState =>
  args.visibleTail.reduce((state, event) => withEntry(state, entryOf(event)), {
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
    breakdown: live ? state.breakdown : null,
  }
}
