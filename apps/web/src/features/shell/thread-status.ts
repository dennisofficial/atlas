import type { WireThread } from '@dltech/atlas-wire/web'

export enum EThreadStatus {
  Idle = 'idle',
  PrOpen = 'pr-open',
  PrMerged = 'pr-merged',
}

type ThreadPullRequest = NonNullable<WireThread['pullRequests']>[number]

const MERGED = 'merged'
const CLOSED = 'closed'

export function threadStatusOf(thread: WireThread): EThreadStatus {
  const pullRequests = thread.pullRequests ?? []
  if (pullRequests.some((pullRequest) => pullRequest.state === MERGED)) {
    return EThreadStatus.PrMerged
  }
  if (pullRequests.some((pullRequest) => pullRequest.state !== CLOSED)) {
    return EThreadStatus.PrOpen
  }
  return EThreadStatus.Idle
}

export function linkedPullRequestOf(thread: WireThread): ThreadPullRequest | undefined {
  const pullRequests = thread.pullRequests ?? []
  return pullRequests.find((pullRequest) => pullRequest.state !== CLOSED) ?? pullRequests[0]
}
