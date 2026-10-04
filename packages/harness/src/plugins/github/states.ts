import { type AfterTurn, type OnThreadOpen, type PullRequestState } from '@dltech/atlas-core'

import type { PullRequestService } from './pull-request-service'
import { EPullRequestLookup, type RepositoryCheckout } from './pure'
import type { PullRequest } from './pure'
import { pullRequestLinkKey } from './links'

export type PullRequestStates = {
  recordChange: AfterTurn
  forgetThread: OnThreadOpen
}

type Snapshot = {
  repo: string
  number: number
  url: string
  branch: string
  state: PullRequest['state']
  checksRunning: number
  checksPassed: number
  checksFailed: number
}

const repoOf = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`

const snapshotOf = (checkout: RepositoryCheckout, pullRequest: PullRequest): Snapshot => ({
  repo: repoOf(checkout),
  number: pullRequest.number,
  url: pullRequest.url,
  branch: checkout.branch,
  state: pullRequest.state,
  checksRunning: pullRequest.tally.running,
  checksPassed: pullRequest.tally.passed,
  checksFailed: pullRequest.tally.failed,
})

const sameRecorded = (
  snapshot: Snapshot,
  recorded: Pick<PullRequestState, 'number' | 'url' | 'branch' | 'state' | 'checksRunning' | 'checksPassed' | 'checksFailed'>,
): boolean =>
  snapshot.number === recorded.number &&
  snapshot.url === recorded.url &&
  snapshot.branch === recorded.branch &&
  snapshot.state === recorded.state &&
  snapshot.checksRunning === recorded.checksRunning &&
  snapshot.checksPassed === recorded.checksPassed &&
  snapshot.checksFailed === recorded.checksFailed

/**
 * The change-only drafter the design's "local reading cache" slice assigns to this plugin
 * (docs/realtime-pr-ci.md). Change-only is load-bearing: the AfterTurn hook already runs once per
 * turn, so an unguarded drafter would append one event per turn even when nothing moved, and an
 * SSE check stream's steady churn would append one per push. The fold holds the latest recorded
 * state per pull request; the in-flight set covers the gap between a draft leaving the hook and
 * the next read publishing it, exactly as `links.recordFound` bridges the same gap, so consecutive
 * turn boundaries never double-write. `mergeable` is `null` because the live `PullRequest` reading
 * does not carry it yet — the projection's consumers already tolerate the unknown.
 */
export function createPullRequestStates(args: {
  service: PullRequestService
  recorded: () => readonly PullRequestState[]
}): PullRequestStates {
  const drafted = new Map<string, Snapshot>()

  const alreadyCovered = (snapshot: Snapshot): boolean => {
    const identity = pullRequestLinkKey({ repo: snapshot.repo, number: snapshot.number })
    const folded = args
      .recorded()
      .find((state) => pullRequestLinkKey({ repo: state.repo, number: state.number }) === identity)
    if (folded !== undefined) {
      // Once the log holds any state for this pull request the in-flight draft is discharged and
      // the durable fold takes over the comparison. Without the discharge a published-but-stale
      // draft would shadow the fold forever, and a state that moved on after publish would never
      // be re-drafted.
      drafted.delete(identity)
      return sameRecorded(snapshot, folded)
    }

    const pending = drafted.get(identity)
    return pending !== undefined && sameRecorded(snapshot, pending)
  }

  return {
    recordChange: async () => {
      const found = args.service.current()
      if (found === null) return {}
      if (found.reading.lookup !== EPullRequestLookup.Found) return {}

      const snapshot = snapshotOf(found.checkout, found.reading.pullRequest)
      if (alreadyCovered(snapshot)) return {}

      const identity = pullRequestLinkKey({ repo: snapshot.repo, number: snapshot.number })
      drafted.set(identity, snapshot)
      return {
        drafts: [
          {
            type: 'pull-request-state',
            number: snapshot.number,
            url: snapshot.url,
            repo: snapshot.repo,
            branch: snapshot.branch,
            state: snapshot.state,
            checksRunning: snapshot.checksRunning,
            checksPassed: snapshot.checksPassed,
            checksFailed: snapshot.checksFailed,
            mergeable: null,
            recordedAt: new Date().toISOString(),
          },
        ],
      }
    },
    forgetThread: async () => {
      drafted.clear()
      return {}
    },
  }
}
