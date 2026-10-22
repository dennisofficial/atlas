import type { ThreadId } from '@dltech/atlas-core'

import type { FamilyTracker } from './family-tracker'
import { checkoutKey, EChecksState, EPullRequestLookup } from './pure'
import type { PullRequestService } from './pull-request-service'

export function pendingCiSource(args: {
  service: Pick<PullRequestService, 'snapshot'>
  tracker: Pick<FamilyTracker, 'checkoutFor'>
}): (threadId: ThreadId) => string | undefined {
  return (threadId) => {
    const checkout = args.tracker.checkoutFor({ threadId })
    if (checkout === null) return undefined

    const reading = args.service.snapshot({ key: checkoutKey(checkout) })
    if (reading.lookup !== EPullRequestLookup.Found) return undefined
    if (reading.pullRequest.checks !== EChecksState.Running) return undefined
    return `CI on #${reading.pullRequest.number}`
  }
}
