import type { GithubConnectionState } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type GithubConnection = GithubConnectionState

export const GITHUB_ORG_SCOPE = 'read:org'
export const GITHUB_REPO_SCOPE = 'repo'

export const fetchGithub = (): Promise<GithubConnection> => cloudCall(api.github.get.query())

export const githubLoginOf = (connection: GithubConnection): string | null =>
  connection.connected ? connection.login : null
