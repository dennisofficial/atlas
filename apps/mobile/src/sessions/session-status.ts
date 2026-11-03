import type { WireThread } from '@dltech/atlas-wire/web'

export enum ESessionStatus {
  Awaiting = 'awaiting',
  Running = 'running',
  Starting = 'starting',
  Failed = 'failed',
  Parked = 'parked',
  Idle = 'idle',
}

export const sessionStatusOf = (thread: WireThread): ESessionStatus => {
  const status = thread.status
  if (status === undefined) return ESessionStatus.Idle
  if (status.awaiting !== null) return ESessionStatus.Awaiting
  if (status.working) return ESessionStatus.Running
  if (status.podState === 'booting') return ESessionStatus.Starting
  if (status.podState === 'failed' || status.lastOutcome === 'failed') return ESessionStatus.Failed
  if (status.podState === 'parked') return ESessionStatus.Parked
  return ESessionStatus.Idle
}
