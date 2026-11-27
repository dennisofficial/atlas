import {
  EGithubPollStatus,
  type GithubConnectionState,
  type GithubDeviceCodes,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'

export const GITHUB_ORG_SCOPE = 'read:org'
export const GITHUB_REPO_SCOPE = 'repo'

const SLOW_DOWN_STEP_MS = 5000

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

export async function pollUntilSettled(args: {
  codes: GithubDeviceCodes
  poll: (deviceCode: string) => Promise<GithubPollResult>
  wait: (ms: number) => Promise<void>
  now: () => number
  isCancelled: () => boolean
}): Promise<GithubPollResult | null> {
  const deadline = args.now() + args.codes.expiresInMs
  let intervalMs = args.codes.intervalMs
  for (;;) {
    await args.wait(intervalMs)
    if (args.isCancelled()) return null
    if (args.now() > deadline) return { status: EGithubPollStatus.Expired }
    const result = await args.poll(args.codes.deviceCode)
    if (args.isCancelled()) return null
    if (result.status === EGithubPollStatus.SlowDown) intervalMs += SLOW_DOWN_STEP_MS
    else if (result.status !== EGithubPollStatus.Pending) return result
  }
}
