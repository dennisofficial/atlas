import type { WireThread } from '@dltech/atlas-wire/web'

export enum EThreadStatus {
  Awaiting = 'awaiting',
  Running = 'running',
  Starting = 'starting',
  Failed = 'failed',
  PrMerged = 'pr-merged',
  PrOpen = 'pr-open',
  PrClosed = 'pr-closed',
  Idle = 'idle',
}

const MERGED = 'merged'
const CLOSED = 'closed'

function pullRequestStatusOf(thread: WireThread): EThreadStatus {
  const pullRequests = (thread.pullRequests ?? []).filter(
    (pullRequest) => pullRequest.via === undefined,
  )
  if (
    pullRequests.some((pullRequest) => pullRequest.state !== CLOSED && pullRequest.state !== MERGED)
  ) {
    return EThreadStatus.PrOpen
  }
  if (pullRequests.some((pullRequest) => pullRequest.state === MERGED)) {
    return EThreadStatus.PrMerged
  }
  if (pullRequests.length > 0) return EThreadStatus.PrClosed
  return EThreadStatus.Idle
}

export function threadStatusOf(thread: WireThread): EThreadStatus {
  const status = thread.status
  if (status !== undefined) {
    if (status.awaiting !== null) return EThreadStatus.Awaiting
    if (status.working) return EThreadStatus.Running
    if (status.podState === 'booting') return EThreadStatus.Starting
    if (status.podState === 'failed' || status.lastOutcome === 'failed') {
      return EThreadStatus.Failed
    }
  }
  return pullRequestStatusOf(thread)
}

export function isWorking(thread: WireThread): boolean {
  return thread.status?.working === true
}

export function isUnread(args: { thread: WireThread; active: boolean }): boolean {
  const status = args.thread.status
  if (args.active || status === undefined) return false
  if (status.lastAssistantSeq <= 0) return false
  if (status.working && status.awaiting === null) return false
  return status.lastAssistantSeq > (status.readSeq ?? -1)
}
