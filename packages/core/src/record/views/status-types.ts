export enum ESessionStatus {
  Preparing = 'preparing',
  SetupFailed = 'setup-failed',
  StartFailed = 'start-failed',
  Queued = 'queued',
  Thinking = 'thinking',
  RunningTool = 'running-tool',
  RunningCommand = 'running-command',
  WaitingToRetry = 'waiting-to-retry',
  WaitingForCredentials = 'waiting-for-credentials',
  WaitingForOperator = 'waiting-for-operator',
  Resuming = 'resuming',
  WaitingForBackground = 'waiting-for-background',
  Idle = 'idle',
  Failed = 'failed',
}

export type SessionStatus = {
  state: ESessionStatus
  reason?: string | undefined
  since?: string | undefined
}

export enum ESessionActivity {
  Setup = 'setup',
  Turn = 'turn',
  Command = 'command',
  Waiting = 'waiting',
  Settled = 'settled',
}

const ACTIVITY_OF_STATUS: Record<ESessionStatus, ESessionActivity> = {
  [ESessionStatus.Preparing]: ESessionActivity.Setup,
  [ESessionStatus.Queued]: ESessionActivity.Turn,
  [ESessionStatus.Thinking]: ESessionActivity.Turn,
  [ESessionStatus.RunningTool]: ESessionActivity.Turn,
  [ESessionStatus.WaitingToRetry]: ESessionActivity.Turn,
  [ESessionStatus.Resuming]: ESessionActivity.Turn,
  [ESessionStatus.RunningCommand]: ESessionActivity.Command,
  [ESessionStatus.WaitingForCredentials]: ESessionActivity.Waiting,
  [ESessionStatus.WaitingForOperator]: ESessionActivity.Waiting,
  [ESessionStatus.WaitingForBackground]: ESessionActivity.Waiting,
  [ESessionStatus.Idle]: ESessionActivity.Settled,
  [ESessionStatus.SetupFailed]: ESessionActivity.Settled,
  [ESessionStatus.StartFailed]: ESessionActivity.Settled,
  [ESessionStatus.Failed]: ESessionActivity.Settled,
}

export const sessionActivityOf = (state: ESessionStatus): ESessionActivity =>
  ACTIVITY_OF_STATUS[state]

export const isSettledStatus = (state: ESessionStatus): boolean =>
  sessionActivityOf(state) === ESessionActivity.Settled
