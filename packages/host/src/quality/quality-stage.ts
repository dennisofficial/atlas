import type { QualityReviewPort, ThreadId } from '@dltech/atlas-core'
import type { QualityStagePort } from '@dltech/atlas-agent'
import type { LogPort } from '@dltech/atlas-observability'

import { containedLog, qualityReviewFor } from './quality-stage-outcome'

export const QUALITY_REVIEW_BUDGET_MS = 1000

export const qualityStageOf = (args: {
  review: QualityReviewPort
  clock: () => number
  logPort?: LogPort | undefined
  budgetMs?: number | undefined
}): QualityStagePort => {
  const budgetMs = args.budgetMs ?? QUALITY_REVIEW_BUDGET_MS
  const captureEnabled = ({ threadId }: { threadId: ThreadId }): boolean => {
    try {
      return args.review.captureEnabled() === true
    } catch (error) {
      containedLog({
        logPort: args.logPort,
        message: 'the quality review port could not say whether to capture file changes',
        threadId,
        error,
      })
      return false
    }
  }
  return {
    captureEnabled,
    review: (reviewArgs) => qualityReviewFor({ ...args, ...reviewArgs, budgetMs }),
  }
}
