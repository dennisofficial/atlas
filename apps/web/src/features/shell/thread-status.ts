import { ELocalActivityState, type ThreadDisplay } from '@/features/threads/data/thread-display'

export enum EThreadStatus {
  Awaiting = 'awaiting',
  Running = 'running',
  Starting = 'starting',
  Failed = 'failed',
  PrMerged = 'pr-merged',
  PrOpen = 'pr-open',
  PrClosed = 'pr-closed',
  Idle = 'idle',
  Unavailable = 'unavailable',
}

const MERGED = 'merged'
const CLOSED = 'closed'

function pullRequestStatusOf(thread: ThreadDisplay): EThreadStatus {
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

export function threadStatusOf(thread: ThreadDisplay): EThreadStatus {
  if (thread.localAvailability?.activityState === ELocalActivityState.Unavailable) {
    return EThreadStatus.Unavailable
  }
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

export function isWorking(thread: ThreadDisplay): boolean {
  if (thread.localAvailability?.activityState === ELocalActivityState.Unavailable) return false
  return thread.status?.working === true
}

export function isUnread(args: { thread: ThreadDisplay; active: boolean }): boolean {
  const local = args.thread.localAvailability
  if (local !== undefined) {
    if (args.active || local.lastAssistantSeq === null || local.lastAssistantSeq <= 0) return false
    if (!('readSeq' in local) || local.readSeq === undefined) return false
    if (
      local.activityState === ELocalActivityState.Available &&
      args.thread.status?.working &&
      args.thread.status.awaiting === null
    )
      return false
    return local.lastAssistantSeq > (local.readSeq ?? -1)
  }
  const status = args.thread.status
  if (args.active || status === undefined) return false
  if (status.lastAssistantSeq <= 0) return false
  if (status.working && status.awaiting === null) return false
  return status.lastAssistantSeq > (status.readSeq ?? -1)
}
