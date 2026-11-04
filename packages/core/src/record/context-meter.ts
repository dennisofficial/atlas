import { estimateTextTokens } from '../assembly/tokens'
import { estimateBodyTokens } from '../models/usage'
import type { V2Event } from './event'
import { visibleEvents } from './visibility'

export enum EMeterBasis {
  Measured = 'measured',
  Estimated = 'estimated',
}

export type ContextMeter = {
  used: number
  window: number | null
  basis: EMeterBasis
  measuredThroughSeq: number | null
  estimatedTokens: number
}

type StepEvent = Extract<V2Event, { type: 'assistant-said' | 'tool-called' }>

const isStep = (event: V2Event): event is StepEvent =>
  event.type === 'assistant-said' || event.type === 'tool-called'

const readingOf = (event: V2Event) => (isStep(event) ? event.usage : undefined)

const tokensOf = (event: V2Event): number => {
  if (event.type === 'history-summarised') return estimateTextTokens(event.summary)
  if (
    event.type === 'history-rewound' ||
    event.type === 'input-consumed' ||
    event.type === 'fact-recorded' ||
    event.type === 'branches-observed'
  )
    return 0
  return estimateBodyTokens(event)
}

const sum = (events: readonly V2Event[]): number =>
  events.reduce((total, event) => total + tokensOf(event), 0)

const lastWindowIn = (events: readonly V2Event[]): number | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const window = readingOf(events[index] as V2Event)?.contextWindow
    if (window !== undefined) return window
  }
  return null
}

/**
 * The rest of a step's tool calls share the reading on its first event, and its output tokens
 * already count them.
 */
const afterOwnStep = (tail: readonly V2Event[]): readonly V2Event[] => {
  const firstForeign = tail.findIndex((event) => event.type !== 'tool-called')
  return firstForeign < 0 ? [] : tail.slice(firstForeign)
}

/**
 * How full the window of the model that last ran stands, read from the visible log alone: the last
 * call's reported input plus output, plus an estimate of what has landed since (tool results,
 * operator messages), so it rises between calls too. A rewound reading is invisible and so never
 * read; a summary after the reading voids it until the next call measures the shrunk context. The
 * window is the last call's, hidden or not: hiding history does not change which model ran.
 */
export function contextMeterOf(events: readonly V2Event[]): ContextMeter {
  const visible = visibleEvents(events)
  const window = lastWindowIn(events)
  const readingAt = visible.findLastIndex((event) => readingOf(event) !== undefined)
  const summarisedAt = visible.findLastIndex((event) => event.type === 'history-summarised')

  const reading = readingAt < 0 ? undefined : readingOf(visible[readingAt] as V2Event)
  if (reading === undefined || summarisedAt > readingAt) {
    const estimatedTokens = sum(visible)
    return {
      used: estimatedTokens,
      window,
      basis: EMeterBasis.Estimated,
      measuredThroughSeq: null,
      estimatedTokens,
    }
  }

  const measured = Math.max(0, reading.inputTokens) + Math.max(0, reading.outputTokens)
  const estimatedTokens = sum(afterOwnStep(visible.slice(readingAt + 1)))
  return {
    used: measured + estimatedTokens,
    window,
    basis: EMeterBasis.Measured,
    measuredThroughSeq: (visible[readingAt] as V2Event).seq,
    estimatedTokens,
  }
}
