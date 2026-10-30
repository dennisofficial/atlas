import type {
  GithubConnectionState,
  GithubDeviceCodes,
  GithubPollResult,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type GithubConnection = GithubConnectionState

export const GITHUB_ORG_SCOPE = 'read:org'
export const GITHUB_REPO_SCOPE = 'repo'

export const fetchGithub = (): Promise<GithubConnection> => cloudCall(api.github.get.query())

export const githubLoginOf = (connection: GithubConnection): string | null =>
  connection.connected ? connection.login : null

export const beginGithubConnect = (): Promise<GithubDeviceCodes> =>
  cloudCall(api.github.beginConnect.mutate())

export const pollGithubConnect = (deviceCode: string): Promise<GithubPollResult> =>
  cloudCall(api.github.pollConnect.mutate({ deviceCode }))

export const disconnectGithub = (): Promise<void> => cloudCall(api.github.disconnect.mutate())
