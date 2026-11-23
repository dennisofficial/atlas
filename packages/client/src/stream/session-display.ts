import { ESessionStatus } from '@dltech/atlas-core'
import { ESandboxStatus } from '@dltech/atlas-protocol'

export enum ESessionDisplay {
  Starting = 'starting',
  StartFailed = 'start-failed',
  Working = 'working',
  WaitingForYou = 'waiting-for-you',
  Idle = 'idle',
  Parked = 'parked',
  Failed = 'failed',
}

const BASE: Record<ESessionStatus, ESessionDisplay> = {
  [ESessionStatus.Failed]: ESessionDisplay.Failed,
  [ESessionStatus.SetupFailed]: ESessionDisplay.StartFailed,
  [ESessionStatus.StartFailed]: ESessionDisplay.StartFailed,
  [ESessionStatus.WaitingForCredentials]: ESessionDisplay.WaitingForYou,
  [ESessionStatus.WaitingForOperator]: ESessionDisplay.WaitingForYou,
  [ESessionStatus.Preparing]: ESessionDisplay.Starting,
  [ESessionStatus.Queued]: ESessionDisplay.Idle,
  [ESessionStatus.Thinking]: ESessionDisplay.Working,
  [ESessionStatus.RunningTool]: ESessionDisplay.Working,
  [ESessionStatus.WaitingToRetry]: ESessionDisplay.Working,
  [ESessionStatus.Resuming]: ESessionDisplay.Working,
  [ESessionStatus.WaitingForBackground]: ESessionDisplay.Working,
  [ESessionStatus.Idle]: ESessionDisplay.Idle,
}

const POD: Partial<Record<ESandboxStatus, ESessionDisplay>> = {
  [ESandboxStatus.Provisioning]: ESessionDisplay.Starting,
  [ESandboxStatus.Starting]: ESessionDisplay.Starting,
  [ESandboxStatus.Restarting]: ESessionDisplay.Starting,
  [ESandboxStatus.Updating]: ESessionDisplay.Starting,
  [ESandboxStatus.Waking]: ESessionDisplay.Starting,
  [ESandboxStatus.Sleeping]: ESessionDisplay.Parked,
  [ESandboxStatus.Stopping]: ESessionDisplay.Parked,
  [ESandboxStatus.Stopped]: ESessionDisplay.Parked,
  [ESandboxStatus.Deleting]: ESessionDisplay.Parked,
  [ESandboxStatus.Deleted]: ESessionDisplay.Parked,
  [ESandboxStatus.Failed]: ESessionDisplay.Failed,
}

export const sessionDisplayOf = (args: {
  state: ESessionStatus | undefined
  sandboxStatus: ESandboxStatus | undefined
}): ESessionDisplay | undefined => {
  if (args.state === undefined) return undefined
  const display = BASE[args.state]
  if (display !== ESessionDisplay.Idle || args.sandboxStatus === undefined) return display
  return POD[args.sandboxStatus] ?? display
}

export const isSessionUnreadOf = (args: {
  display: ESessionDisplay | undefined
  lastAssistantSeq: number
  readSeq: number | null
}): boolean => {
  if (args.lastAssistantSeq <= 0) return false
  if (args.display === ESessionDisplay.Working) return false
  return args.lastAssistantSeq > (args.readSeq ?? -1)
}
