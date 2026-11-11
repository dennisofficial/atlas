import type { StepReading } from '../events/body'
import type { Event } from '../events/envelope'
import type { ModelUsage } from '../stream/chunk'

/**
 * What the last request carried, as the provider counted it: everything it was sent plus everything
 * it wrote. No model's tokenizer is ours to reproduce, so a call that reported nothing leaves the
 * window unmeasured rather than guessed.
 */
export function contextTokens(reported: ModelUsage | null): number | null {
  if (reported === null) return null
  return Math.max(0, reported.inputTokens) + Math.max(0, reported.outputTokens)
}

/**
 * The usage the last model call reported, read back from the step it wrote, so every reader of the
 * transcript sees the same number a live stream did. A compaction after it shrank the window, so
 * that reading no longer describes it.
 */
export function lastStepUsage(events: readonly Event[]): StepReading | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'history-compacted') return null
    if (event.type !== 'assistant-said' && event.type !== 'tool-called') continue
    if (event.usage !== undefined) return event.usage
  }
  return null
}

export const contextTokensOf = (events: readonly Event[]): number | null =>
  contextTokens(lastStepUsage(events))

export type BilledUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const NOTHING_BILLED: BilledUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const countedOrNothing = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || value < 0 ? 0 : value

/**
 * Every step is billed the whole prompt it sent, so a turn's spend is the sum over its steps —
 * unlike its context, which is only ever the last step's report.
 */
export function addUsage(args: { billed: BilledUsage; step: ModelUsage | undefined }): BilledUsage {
  const { billed, step } = args
  if (step === undefined) return billed
  return {
    inputTokens: billed.inputTokens + countedOrNothing(step.inputTokens),
    outputTokens: billed.outputTokens + countedOrNothing(step.outputTokens),
    cacheReadTokens: billed.cacheReadTokens + countedOrNothing(step.cacheReadTokens),
    cacheWriteTokens: billed.cacheWriteTokens + countedOrNothing(step.cacheWriteTokens),
  }
}
