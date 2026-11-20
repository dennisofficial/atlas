import { ESessionStatus } from '@dltech/atlas-core'
import type { ESandboxProvider } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { EThreadStatus } from './thread-status'

export type V2RowView = {
  status: ESessionStatus | undefined
  branch: string | undefined
  pullRequest: PullRequestEntry | undefined
  routineId: string | undefined
  sandboxProvider: ESandboxProvider | undefined
  lastAssistantSeq: number
  readSeq: number | null
}

const ICON: Record<ESessionStatus, EThreadStatus> = {
  [ESessionStatus.Failed]: EThreadStatus.Failed,
  [ESessionStatus.SetupFailed]: EThreadStatus.Failed,
  [ESessionStatus.StartFailed]: EThreadStatus.Failed,
  [ESessionStatus.WaitingForCredentials]: EThreadStatus.Awaiting,
  [ESessionStatus.WaitingForOperator]: EThreadStatus.Awaiting,
  [ESessionStatus.Preparing]: EThreadStatus.Starting,
  [ESessionStatus.Queued]: EThreadStatus.Idle,
  [ESessionStatus.Thinking]: EThreadStatus.Running,
  [ESessionStatus.RunningTool]: EThreadStatus.Running,
  [ESessionStatus.WaitingToRetry]: EThreadStatus.Running,
  [ESessionStatus.Resuming]: EThreadStatus.Running,
  [ESessionStatus.WaitingForBackground]: EThreadStatus.Running,
  [ESessionStatus.Idle]: EThreadStatus.Idle,
}

export const v2StatusIconOf = (status: ESessionStatus | undefined): EThreadStatus | undefined =>
  status === undefined ? undefined : ICON[status]

export const v2IsUnread = (args: { view: V2RowView; active: boolean }): boolean => {
  if (args.active) return false
  if (args.view.lastAssistantSeq <= 0) return false
  if (v2StatusIconOf(args.view.status) === EThreadStatus.Running) return false
  return args.view.lastAssistantSeq > (args.view.readSeq ?? -1)
}
