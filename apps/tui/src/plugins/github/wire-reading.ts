import { EPullRequestState } from '@dltech/atlas-core'
import {
  EChecksState,
  EPullRequestLookup,
  type PullRequest,
  type PullRequestReading,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'
import type { PrStateWire } from '@dltech/atlas-wire'

const wireChecksOf = (state: PrStateWire): PullRequest['checks'] => {
  if (state.checksFailed > 0) return EChecksState.Failing
  if (state.checksRunning > 0) return EChecksState.Running
  if (state.checksPassed > 0) return EChecksState.Passing
  return EChecksState.None
}

/**
 * A cloud thread's live state arrives over the channel as a wire record, not a service reading. The
 * tile renders it the same way — only the source differs.
 */
const wireStateOf = (state: PrStateWire['state']): PullRequest['state'] => {
  if (state === 'open') return EPullRequestState.Open
  if (state === 'draft') return EPullRequestState.Draft
  if (state === 'merged') return EPullRequestState.Merged
  return EPullRequestState.Closed
}

export const wireReading = (state: PrStateWire): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: state.number,
    title: '',
    url: state.url,
    state: wireStateOf(state.state),
    checks: wireChecksOf(state),
    tally: { running: state.checksRunning, passed: state.checksPassed, failed: state.checksFailed },
    mergeable: state.mergeable,
    comments: [],
    reviews: [],
  },
})

export const repoStringOf = (checkout: RepositoryCheckout): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}`
