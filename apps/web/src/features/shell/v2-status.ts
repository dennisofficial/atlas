import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus, type ESandboxProvider } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { EThreadStatus } from './thread-status'

export type V2RowView = {
  status: ESessionStatus | undefined
  sandboxStatus: ESandboxStatus | undefined
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

const POD_ICON: Partial<Record<ESandboxStatus, EThreadStatus>> = {
  [ESandboxStatus.Provisioning]: EThreadStatus.Starting,
  [ESandboxStatus.Starting]: EThreadStatus.Starting,
  [ESandboxStatus.Restarting]: EThreadStatus.Starting,
  [ESandboxStatus.Updating]: EThreadStatus.Starting,
  [ESandboxStatus.Waking]: EThreadStatus.Starting,
  [ESandboxStatus.Sleeping]: EThreadStatus.Parked,
  [ESandboxStatus.Stopping]: EThreadStatus.Parked,
  [ESandboxStatus.Stopped]: EThreadStatus.Parked,
  [ESandboxStatus.Deleting]: EThreadStatus.Parked,
  [ESandboxStatus.Deleted]: EThreadStatus.Parked,
  [ESandboxStatus.Failed]: EThreadStatus.Failed,
}

export const v2StatusIconOf = (view: V2RowView | undefined): EThreadStatus | undefined => {
  if (view === undefined || view.status === undefined) return undefined
  const icon = ICON[view.status]
  if (icon !== EThreadStatus.Idle || view.sandboxStatus === undefined) return icon
  return POD_ICON[view.sandboxStatus] ?? icon
}

export const v2IsUnread = (args: { view: V2RowView; active: boolean }): boolean => {
  if (args.active) return false
  if (args.view.lastAssistantSeq <= 0) return false
  if (v2StatusIconOf(args.view) === EThreadStatus.Running) return false
  return args.view.lastAssistantSeq > (args.view.readSeq ?? -1)
}
