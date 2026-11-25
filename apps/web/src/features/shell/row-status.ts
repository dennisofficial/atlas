import { ESessionDisplay, isSessionUnreadOf, sessionDisplayOf } from '@dltech/atlas-client/stream'
import type { ESessionStatus } from '@dltech/atlas-core'
import type { ESandboxProvider, ESandboxStatus } from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { EThreadStatus } from './thread-status'

export type RowView = {
  status: ESessionStatus | undefined
  sandboxStatus: ESandboxStatus | undefined
  branch: string | undefined
  pullRequest: PullRequestEntry | undefined
  routineId: string | undefined
  sandboxProvider: ESandboxProvider | undefined
  lastAssistantSeq: number
  readSeq: number | null
}

const ICON: Record<ESessionDisplay, EThreadStatus> = {
  [ESessionDisplay.Starting]: EThreadStatus.Starting,
  [ESessionDisplay.StartFailed]: EThreadStatus.Failed,
  [ESessionDisplay.Working]: EThreadStatus.Running,
  [ESessionDisplay.WaitingForYou]: EThreadStatus.Awaiting,
  [ESessionDisplay.Idle]: EThreadStatus.Idle,
  [ESessionDisplay.Parked]: EThreadStatus.Parked,
  [ESessionDisplay.Failed]: EThreadStatus.Failed,
}

const displayOf = (view: RowView): ESessionDisplay | undefined =>
  sessionDisplayOf({ state: view.status, sandboxStatus: view.sandboxStatus })

export const statusIconOf = (view: RowView | undefined): EThreadStatus | undefined => {
  if (view === undefined) return undefined
  const display = displayOf(view)
  return display === undefined ? undefined : ICON[display]
}

export const isSessionUnread = (args: { view: RowView; active: boolean }): boolean => {
  if (args.active) return false
  return isSessionUnreadOf({
    display: displayOf(args.view),
    lastAssistantSeq: args.view.lastAssistantSeq,
    readSeq: args.view.readSeq,
  })
}
