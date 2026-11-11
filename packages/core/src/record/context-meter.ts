import type { V2Event } from './event'
import { visibleEvents } from './visibility'
import { stepReadingOf } from './views/step-reading'

export type ContextMeter = {
  used: number | null
  window: number | null
  measuredThroughSeq: number | null
}

const lastWindowIn = (events: readonly V2Event[]): number | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const window = stepReadingOf(events[index] as V2Event)?.contextWindow
    if (window !== undefined) return window
  }
  return null
}

/**
 * How full the window of the model that last ran stands, as that model reported it. A rewound
 * reading is invisible and so never read; a summary after the reading voids it until the next call
 * measures the shrunk context. The window is the last call's, hidden or not: hiding history does not
 * change which model ran.
 */
export function contextMeterOf(events: readonly V2Event[]): ContextMeter {
  const visible = visibleEvents(events)
  const window = lastWindowIn(events)
  const readingAt = visible.findLastIndex((event) => stepReadingOf(event) !== undefined)
  const summarisedAt = visible.findLastIndex((event) => event.type === 'history-summarised')

  const reading = readingAt < 0 ? undefined : stepReadingOf(visible[readingAt] as V2Event)
  if (reading === undefined || summarisedAt > readingAt) {
    return { used: null, window, measuredThroughSeq: null }
  }

  return {
    used: Math.max(0, reading.inputTokens) + Math.max(0, reading.outputTokens),
    window,
    measuredThroughSeq: (visible[readingAt] as V2Event).seq,
  }
}
