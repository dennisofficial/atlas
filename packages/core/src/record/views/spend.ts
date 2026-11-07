import type { SpendRow } from '../../models/spend-tally'
import type { V2Event } from '../event'
import { stepReadingOf } from './step-reading'

export type SpendState = { rows: readonly SpendRow[] }

export const initialSpendState: SpendState = { rows: [] }

const UNKNOWN_MODEL = 'unknown'

export const stepSpend = (state: SpendState, event: V2Event): SpendState => {
  const reading = stepReadingOf(event)
  if (reading === undefined) return state
  const providerId = reading.providerId ?? UNKNOWN_MODEL
  const modelId = reading.modelId ?? UNKNOWN_MODEL
  const index = state.rows.findIndex(
    (row) => row.providerId === providerId && row.modelId === modelId,
  )
  const previous = state.rows[index]
  const row: SpendRow = {
    providerId,
    modelId,
    inputTokens: (previous?.inputTokens ?? 0) + reading.inputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + reading.outputTokens,
    cacheReadTokens: (previous?.cacheReadTokens ?? 0) + (reading.cacheReadTokens ?? 0),
    cacheWriteTokens: (previous?.cacheWriteTokens ?? 0) + (reading.cacheWriteTokens ?? 0),
  }
  if (index < 0) return { rows: [...state.rows, row] }
  return { rows: state.rows.map((kept, at) => (at === index ? row : kept)) }
}
