import {
  pullRequestsOf,
  type AfterTurn,
  type EventDraft,
  type LinkedPullRequest,
  type OnThreadOpen,
} from '@dltech/atlas-core'

import { defineProjection, type PluginProjection } from '../projection'
import { checkoutKey, EPullRequestLookup, type RepositoryCheckout } from './pure'
import type { FamilyTracker } from './family-tracker'
import type { PullRequestService } from './pull-request-service'

export type PullRequestLinks = {
  projection: PluginProjection<readonly LinkedPullRequest[]>
  recordFound: AfterTurn
  forgetThread: OnThreadOpen
  linkDropped: (args: { checkouts: readonly RepositoryCheckout[] }) => readonly EventDraft[]
}

export const pullRequestLinkKey = (link: { repo: string; number: number }): string =>
  `${link.repo}#${link.number}`

const repoOf = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`

const sameLinks = (
  left: readonly LinkedPullRequest[],
  right: readonly LinkedPullRequest[],
): boolean =>
  left.length === right.length &&
  left.every((link, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      pullRequestLinkKey(link) === pullRequestLinkKey(other) &&
      link.branch === other.branch &&
      link.url === other.url &&
      link.worktreePath === other.worktreePath &&
      link.linkedBy === other.linkedBy
    )
  })

/**
 * The durable half of the pull request story. `recordFound` writes the link: at turn end it takes
 * the latest reading of the checkout the ending thread stands on and drafts the event, so the log
 * accumulates one row per pull request the session family has stood on. `projection` reads them back for the surfaces. The
 * `drafted` set bridges the gap between the two — a draft is not in the fold until the next read
 * publishes it, and without the bridge every turn boundary in between would draft it again.
 */
export function createPullRequestLinks(args: {
  service: PullRequestService
  tracker: FamilyTracker
}): PullRequestLinks {
  const drafted = new Set<string>()

  let folded: readonly LinkedPullRequest[] = []
  const projection = defineProjection<readonly LinkedPullRequest[]>({
    id: 'pull-requests',
    fold: ({ events }) => {
      const next = pullRequestsOf(events)
      if (sameLinks(folded, next)) return folded

      folded = next
      return next
    },
  })

  return {
    projection,
    recordFound: async ({ threadId }) => {
      const checkout = args.tracker.checkoutFor({ threadId })
      if (checkout === null) return {}

      const reading = args.service.snapshot({ key: checkoutKey(checkout) })
      if (reading.lookup !== EPullRequestLookup.Found) return {}

      const repo = repoOf(checkout)
      const { number, url } = reading.pullRequest
      const identity = pullRequestLinkKey({ repo, number })
      const durable = projection.current().some((link) => pullRequestLinkKey(link) === identity)
      if (durable || drafted.has(identity)) return {}

      drafted.add(identity)
      return {
        drafts: [
          {
            type: 'pull-request-linked',
            number,
            url,
            repo,
            branch: checkout.branch,
            worktreePath: checkout.directory,
          },
        ],
      }
    },
    forgetThread: async () => {
      drafted.clear()
      return {}
    },
    /**
     * A checkout leaving the tracked set — the worktree was removed, the thread hopped away — is
     * exactly when its pull request would vanish from the sidebar. The reading still lives until
     * `track()` forgets it in the same call, so the link is drafted here from the last Found answer
     * and returned to the hook that caused the drop, which appends it with its own outcome.
     */
    linkDropped: ({ checkouts }) => {
      const drafts: EventDraft[] = []
      for (const checkout of checkouts) {
        const reading = args.service.snapshot({ key: checkoutKey(checkout) })
        if (reading.lookup !== EPullRequestLookup.Found) continue

        const repo = repoOf(checkout)
        const { number, url } = reading.pullRequest
        const identity = pullRequestLinkKey({ repo, number })
        const durable = projection.current().some((link) => pullRequestLinkKey(link) === identity)
        if (durable || drafted.has(identity)) continue

        drafted.add(identity)
        drafts.push({
          type: 'pull-request-linked',
          number,
          url,
          repo,
          branch: checkout.branch,
          worktreePath: checkout.directory,
        })
      }
      return drafts
    },
  }
}
