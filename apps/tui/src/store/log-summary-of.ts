import type { Event } from '@dltech/atlas-core'

import type { LogAccumulator } from './log-accumulator'
import type { LogSummary } from './log-window'

export const logSummaryOf = (args: {
  acc: LogAccumulator
  events: readonly Event[]
}): LogSummary => {
  const { opening, tokens, treeMutations, worktree, home, repo } = args.acc
  return {
    opening,
    tokens,
    treeMutations,
    worktree,
    home,
    repo,
    windowStartSeq: args.events[0]?.seq ?? 0,
  }
}
