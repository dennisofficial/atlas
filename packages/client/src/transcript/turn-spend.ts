import type { RunId, ThreadId } from '@dltech/atlas-core'

export type TurnSpend = {
  runId: RunId
  threadId: ThreadId
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: string
  endedAt: string
  durationMs: number
}

export type SpendTotals = {
  turns: number
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export const NOTHING_SPENT: SpendTotals = {
  turns: 0,
  steps: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const plus = ({ left, right }: { left: SpendTotals; right: SpendTotals }): SpendTotals => ({
  turns: left.turns + right.turns,
  steps: left.steps + right.steps,
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
})

const asTotals = (row: TurnSpend): SpendTotals => ({
  turns: 1,
  steps: row.steps,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  cacheReadTokens: row.cacheReadTokens,
  cacheWriteTokens: row.cacheWriteTokens,
})

export const totalSpend = (rows: readonly TurnSpend[]): SpendTotals =>
  rows.reduce((running, row) => plus({ left: running, right: asTotals(row) }), NOTHING_SPENT)
