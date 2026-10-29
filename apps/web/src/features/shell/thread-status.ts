import type { WireThread } from '@dltech/atlas-wire/web'

export enum EThreadStatus {
  Idle = 'idle',
  PrOpen = 'pr-open',
  PrMerged = 'pr-merged',
}

const MERGED = 'merged'
const CLOSED = 'closed'

export function threadStatusOf(thread: WireThread): EThreadStatus {
  const pullRequests = thread.pullRequests ?? []
  if (
    pullRequests.some((pullRequest) => pullRequest.state !== CLOSED && pullRequest.state !== MERGED)
  ) {
    return EThreadStatus.PrOpen
  }
  if (pullRequests.some((pullRequest) => pullRequest.state === MERGED)) {
    return EThreadStatus.PrMerged
  }
  return EThreadStatus.Idle
}
