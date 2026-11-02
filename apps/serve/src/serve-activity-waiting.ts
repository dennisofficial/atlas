import type { ActivityReport } from '@dltech/atlas-harness/activity'

import type { ActivityReporter } from './serve-activity-reporter'

export function waitingAwareReport(
  reporter: Pick<ActivityReporter, 'report'>,
): (state: ActivityReport) => void {
  let posted = false
  return ({ waitingForModel, ...state }) => {
    if (waitingForModel !== undefined) {
      posted = true
      reporter.report({ ...state, waitingForModel: JSON.stringify(waitingForModel) })
      return
    }
    if (!posted) {
      reporter.report(state)
      return
    }
    posted = false
    reporter.report({ ...state, waitingForModel: null })
  }
}
