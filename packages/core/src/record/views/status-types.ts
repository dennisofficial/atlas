export enum ESessionStatus {
  Preparing = 'preparing',
  SetupFailed = 'setup-failed',
  Sent = 'sent',
  Thinking = 'thinking',
  RunningTool = 'running-tool',
  WaitingToRetry = 'waiting-to-retry',
  WaitingForCredentials = 'waiting-for-credentials',
  Resuming = 'resuming',
  Idle = 'idle',
  Failed = 'failed',
}

export type SessionStatus = {
  state: ESessionStatus
  reason?: string | undefined
  since?: string | undefined
}
