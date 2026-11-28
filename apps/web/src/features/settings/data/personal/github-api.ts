import type { GithubConnectionState } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type GithubConnection = GithubConnectionState

export {
  GITHUB_ORG_SCOPE,
  GITHUB_REPO_SCOPE,
  githubLoginOf,
} from '@dltech/atlas-client/settings'

export const fetchGithub = (): Promise<GithubConnection> => cloudCall(api.github.get.query())

export const beginGithubConnect = (): Promise<{ url: string }> =>
  cloudCall(api.github.beginRedirect.mutate())

export const disconnectGithub = (): Promise<void> => cloudCall(api.github.disconnect.mutate())
