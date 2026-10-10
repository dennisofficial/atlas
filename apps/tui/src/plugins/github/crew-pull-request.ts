import type { ThreadId } from '@dltech/atlas-core'
import {
  checkoutKey,
  EPullRequestLookup,
  pullRequestBadge,
  type PullRequestBadge,
  type PullRequestService,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'

export type CrewPullRequests = {
  service: Pick<PullRequestService, 'snapshot' | 'version' | 'subscribe'>
  checkoutFor: (args: { threadId: ThreadId }) => RepositoryCheckout | null
}

export function crewPullRequestOf(args: {
  reader: CrewPullRequests
  threadId: ThreadId
}): PullRequestBadge | null {
  const checkout = args.reader.checkoutFor({ threadId: args.threadId })
  if (checkout === null) return null

  const reading = args.reader.service.snapshot({ key: checkoutKey(checkout) })
  if (reading.lookup !== EPullRequestLookup.Found) return null

  return pullRequestBadge(reading.pullRequest)
}
