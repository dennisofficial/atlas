import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire'

import { EPullRequestLookup, EPullRequestState, type PullRequestReading, type RepositoryCheckout } from './pure'
import type { PullRequest } from './pure'
import { pullRequestLinkKey } from './links'

export const repoOf = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`

const wireStateOf = (state: EPullRequestState): EPullRequestStateWire => {
  if (state === EPullRequestState.Open) return EPullRequestStateWire.Open
  if (state === EPullRequestState.Draft) return EPullRequestStateWire.Draft
  if (state === EPullRequestState.Merged) return EPullRequestStateWire.Merged
  return EPullRequestStateWire.Closed
}

const wireState = (args: { repo: string; branch: string; pullRequest: PullRequest }): PrStateWire => ({
  repo: args.repo,
  number: args.pullRequest.number,
  url: args.pullRequest.url,
  branch: args.branch,
  state: wireStateOf(args.pullRequest.state),
  checksRunning: args.pullRequest.tally.running,
  checksPassed: args.pullRequest.tally.passed,
  checksFailed: args.pullRequest.tally.failed,
  mergeable: args.pullRequest.mergeable,
})

export type TrackedReading = {
  key: string
  checkout?: RepositoryCheckout
  link?: { repo: string; number: number; branch: string }
  reading: PullRequestReading
}

/**
 * The serve channel's snapshot of the github plugin's live readings. Only `Found` readings carry
 * state a tile can render; tracked and watched entries are folded together keyed by pull request
 * identity so a PR that is both the tracked checkout and a watched link appears once.
 */
export function pullRequestStatesWireOf(readings: readonly TrackedReading[]): readonly PrStateWire[] {
  const byIdentity = new Map<string, PrStateWire>()
  for (const entry of readings) {
    if (entry.reading.lookup !== EPullRequestLookup.Found) continue

    const repo = entry.checkout !== undefined ? repoOf(entry.checkout) : entry.link?.repo ?? null
    const branch = entry.checkout !== undefined ? entry.checkout.branch : entry.link?.branch ?? null
    if (repo === null || branch === null) continue

    byIdentity.set(
      pullRequestLinkKey({ repo, number: entry.reading.pullRequest.number }),
      wireState({ repo, branch, pullRequest: entry.reading.pullRequest }),
    )
  }
  return [...byIdentity.values()]
}
