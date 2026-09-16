import type { RetryWait } from './retry-countdown'

/**
 * The input side of the turn so far, summed from each finished step's reported usage. The ledger
 * only learns these figures at turn end; this is what lets the sidebar show them while the turn
 * is still running.
 */
export type LiveInput = {
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const NO_LIVE_INPUT: LiveInput = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

export type TurnClock = {
  startedAt: number | null
  outputTokens: number
  input: LiveInput
  interrupting: boolean
  reasoning: boolean
  completed: { durationMs: number; outputTokens: number } | null
  retry: RetryWait | null
}

export const IDLE_TURN: TurnClock = {
  startedAt: null,
  outputTokens: 0,
  input: NO_LIVE_INPUT,
  interrupting: false,
  reasoning: false,
  completed: null,
  retry: null,
}
