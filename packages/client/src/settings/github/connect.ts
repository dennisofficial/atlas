import {
  EGithubPollStatus,
  type GithubConnectionState,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'

export const GITHUB_ORG_SCOPE = 'read:org'
export const GITHUB_REPO_SCOPE = 'repo'

export const githubLoginOf = (connection: GithubConnectionState): string | null =>
  connection.connected ? connection.login : null

export const githubCapabilitiesOf = (
  connection: GithubConnectionState,
): { label: string; granted: boolean }[] => {
  const scopes = connection.connected ? connection.scopes : []
  const grantedScope = (scope: string) => connection.connected && scopes.includes(scope)
  return [
    { label: 'Clone private repos', granted: grantedScope(GITHUB_REPO_SCOPE) },
    { label: 'Open pull requests', granted: grantedScope(GITHUB_REPO_SCOPE) },
    { label: 'Org-wide access', granted: grantedScope(GITHUB_ORG_SCOPE) },
  ]
}

export function githubFailureOf(
  result: Exclude<GithubPollResult, { status: EGithubPollStatus.Connected }>,
): string {
  if (result.status === EGithubPollStatus.Denied) return 'GitHub access was refused'
  if (result.status === EGithubPollStatus.MissingScopes) {
    return `GitHub didn't grant ${result.missing.join(', ')}. Approve every permission to continue.`
  }
  return 'That code expired'
}
