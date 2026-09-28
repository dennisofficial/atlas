import { pullRequestStatesOf, type PullRequestState } from '@dltech/atlas-core'

import { defineProjection, type PluginProjection } from '../projection'
import { pullRequestLinkKey } from './links'

const sameStates = (
  left: readonly PullRequestState[],
  right: readonly PullRequestState[],
): boolean =>
  left.length === right.length &&
  left.every((state, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      pullRequestLinkKey(state) === pullRequestLinkKey(other) &&
      state.state === other.state &&
      state.branch === other.branch &&
      state.url === other.url &&
      state.checksRunning === other.checksRunning &&
      state.checksPassed === other.checksPassed &&
      state.checksFailed === other.checksFailed &&
      state.mergeable === other.mergeable &&
      state.recordedAt === other.recordedAt
    )
  })

export function createPullRequestStateProjection(): PluginProjection<readonly PullRequestState[]> {
  let folded: readonly PullRequestState[] = []
  return defineProjection<readonly PullRequestState[]>({
    id: 'pull-request-states',
    fold: ({ events }) => {
      const next = pullRequestStatesOf(events)
      if (sameStates(folded, next)) return folded

      folded = next
      return next
    },
  })
}
