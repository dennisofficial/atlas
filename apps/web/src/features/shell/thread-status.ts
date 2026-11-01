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
  Parked = 'parked',
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
    if (status.podState === 'parked') return EThreadStatus.Parked
  }
  return EThreadStatus.Idle
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
