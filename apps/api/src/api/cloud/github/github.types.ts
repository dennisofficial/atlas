import type { GithubDeviceCodes, GithubPollResult } from '@dltech/atlas-wire'

export { EGithubPollStatus } from '@dltech/atlas-wire'

export type GithubDeviceCodesDto = GithubDeviceCodes

export type GithubPollResultDto = GithubPollResult

export type GithubConnectionDto =
  | { connected: false }
  | {
      connected: true
      login: string
      scopes: string[]
      missingScopes: string[]
      connectedAt: string
    }

export interface GithubTokenDto {
  token: string
}
