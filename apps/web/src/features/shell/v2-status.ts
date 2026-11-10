import { ESessionStatus } from '@dltech/atlas-core'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { EThreadStatus } from './thread-status'

export type V2RowView = {
  status: ESessionStatus | undefined
  branch: string | undefined
  pullRequest: PullRequestEntry | undefined
  routineId: string | undefined
}

const ICON: Record<ESessionStatus, EThreadStatus> = {
  [ESessionStatus.Failed]: EThreadStatus.Failed,
  [ESessionStatus.SetupFailed]: EThreadStatus.Failed,
  [ESessionStatus.StartFailed]: EThreadStatus.Failed,
  [ESessionStatus.WaitingForCredentials]: EThreadStatus.Awaiting,
  [ESessionStatus.Preparing]: EThreadStatus.Starting,
  [ESessionStatus.Sent]: EThreadStatus.Running,
  [ESessionStatus.Thinking]: EThreadStatus.Running,
  [ESessionStatus.RunningTool]: EThreadStatus.Running,
  [ESessionStatus.WaitingToRetry]: EThreadStatus.Running,
  [ESessionStatus.Resuming]: EThreadStatus.Running,
  [ESessionStatus.Idle]: EThreadStatus.Idle,
}

export const v2StatusIconOf = (status: ESessionStatus | undefined): EThreadStatus | undefined =>
  status === undefined ? undefined : ICON[status]
