import { NOTHING_SPENT, totalSpend, type SpendTotals } from '@dltech/atlas-client/transcript'

import type { ThreadTreeSpend } from './turn-ledger.port'

export { NOTHING_SPENT, totalSpend, type SpendTotals }

export type ThreadTreeTotals = {
  own: SpendTotals
  delegated: SpendTotals
  combined: SpendTotals
}

const plus = ({ left, right }: { left: SpendTotals; right: SpendTotals }): SpendTotals => ({
  turns: left.turns + right.turns,
  steps: left.steps + right.steps,
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
})

export function tallyThreadTreeSpend(spend: ThreadTreeSpend): ThreadTreeTotals {
  const own = totalSpend(spend.own)
  const delegated = totalSpend(spend.delegated)
  return { own, delegated, combined: plus({ left: own, right: delegated }) }
}
