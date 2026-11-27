import type {
  GithubConnectionState,
  GithubDeviceCodes,
  GithubPollResult,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type GithubConnection = GithubConnectionState

export {
  GITHUB_ORG_SCOPE,
  GITHUB_REPO_SCOPE,
  githubLoginOf,
} from '@dltech/atlas-client/settings'

export const fetchGithub = (): Promise<GithubConnection> => cloudCall(api.github.get.query())

export const beginGithubConnect = (): Promise<GithubDeviceCodes> =>
  cloudCall(api.github.beginConnect.mutate())

export const pollGithubConnect = (deviceCode: string): Promise<GithubPollResult> =>
  cloudCall(api.github.pollConnect.mutate({ deviceCode }))

export const disconnectGithub = (): Promise<void> => cloudCall(api.github.disconnect.mutate())
