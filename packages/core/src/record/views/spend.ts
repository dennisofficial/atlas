import { tokenSpendOf, type TokenSpend } from '../../models/cost'
import { unpricedTokensOf, type SpendRow } from '../../models/spend-tally'
import type { RecordEvent } from '../event'
import { stepReadingOf } from './step-reading'

export type SpendState = { rows: readonly SpendRow[] }

export const initialSpendState: SpendState = { rows: [] }

const UNKNOWN_MODEL = 'unknown'

const NOTHING_SPENT: TokenSpend = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const sumTokens = (left: TokenSpend, right: TokenSpend): TokenSpend => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
})

const storedCost = (row: SpendRow, costUsd: number | undefined): number | undefined => {
  if (row.costUsd === undefined && costUsd === undefined) return undefined
  return (row.costUsd ?? 0) + (costUsd ?? 0)
}

export const stepSpend = (state: SpendState, event: RecordEvent): SpendState => {
  const reading = stepReadingOf(event)
  if (reading === undefined) return state
  const providerId = reading.providerId ?? UNKNOWN_MODEL
  const modelId = reading.modelId ?? UNKNOWN_MODEL
  const index = state.rows.findIndex(
    (row) => row.providerId === providerId && row.modelId === modelId,
  )
  const previous = state.rows[index]
  const costUsd = previous === undefined ? reading.costUsd : storedCost(previous, reading.costUsd)
  const row: SpendRow = {
    providerId,
    modelId,
    inputTokens: (previous?.inputTokens ?? 0) + reading.inputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + reading.outputTokens,
    cacheReadTokens: (previous?.cacheReadTokens ?? 0) + (reading.cacheReadTokens ?? 0),
    cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + (reading.cacheWriteTokens ?? 0),
    unpricedTokens: sumTokens(
      previous === undefined ? NOTHING_SPENT : unpricedTokensOf(previous),
      reading.costUsd === undefined ? tokenSpendOf(reading) : NOTHING_SPENT,
    ),
    ...(costUsd === undefined ? {} : { costUsd }),
  }
  if (index < 0) return { rows: [...state.rows, row] }
  return { rows: state.rows.map((kept, at) => (at === index ? row : kept)) }
}
