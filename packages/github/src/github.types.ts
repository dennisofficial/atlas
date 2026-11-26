import type { GithubDeviceCodes, GithubPollResult } from '@dltech/atlas-core'

export { EGithubPollStatus } from '@dltech/atlas-core'

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
