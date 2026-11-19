export enum ESessionStatus {
  Preparing = 'preparing',
  SetupFailed = 'setup-failed',
  StartFailed = 'start-failed',
  Queued = 'queued',
  Thinking = 'thinking',
  RunningTool = 'running-tool',
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
