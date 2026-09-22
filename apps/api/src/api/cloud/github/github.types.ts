export enum EGithubPollStatus {
  Pending = 'pending',
  SlowDown = 'slow-down',
  Denied = 'denied',
  Expired = 'expired',
  Connected = 'connected',
}

export interface GithubDeviceCodesDto {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresInMs: number
  intervalMs: number
}

export type GithubPollResultDto =
  | { status: EGithubPollStatus.Pending }
  | { status: EGithubPollStatus.SlowDown }
  | { status: EGithubPollStatus.Denied }
  | { status: EGithubPollStatus.Expired }
  | { status: EGithubPollStatus.Connected; login: string; scopes: string[] }

export type GithubConnectionDto =
  | { connected: false }
  | { connected: true; login: string; scopes: string[]; connectedAt: string }

export interface GithubTokenDto {
  token: string
}
