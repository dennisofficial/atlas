export enum EGithubCallSource {
  PollSweep = 'poll-sweep',
  HookSweep = 'hook-sweep',
  AppSync = 'app-sync',
  DeliveryFill = 'delivery-fill',
  HookLifecycle = 'hook-lifecycle',
  RepoList = 'repo-list',
  RepoAccess = 'repo-access',
  RepoTree = 'repo-tree',
  SigningKey = 'signing-key',
  DeviceFlow = 'device-flow',
  SubscriptionResolve = 'subscription-resolve',
  CheckAnnotations = 'check-annotations',
  ChecksState = 'checks-state',
  Unattributed = 'unattributed',
}

export enum EGithubCredentialKind {
  User = 'user',
  Installation = 'installation',
  Anonymous = 'anonymous',
  Unknown = 'unknown',
}

export enum EGithubCallLane {
  Essential = 'essential',
  Background = 'background',
}

const USER_TOKEN_PREFIXES = ['gho_', 'ghu_']
const ANONYMOUS_TOKEN = 'anonymous'
const BACKGROUND_SOURCES = new Set<EGithubCallSource>([
  EGithubCallSource.PollSweep,
  EGithubCallSource.HookSweep,
  EGithubCallSource.AppSync,
  EGithubCallSource.HookLifecycle,
])

// GitHub token prefixes: https://github.com/github/docs/blob/main/content/authentication/keeping-your-account-and-data-secure/about-authentication-to-github.md
export const githubCredentialKind = (token: string): EGithubCredentialKind =>
  token === ANONYMOUS_TOKEN
    ? EGithubCredentialKind.Anonymous
    : token.startsWith('ghs_')
      ? EGithubCredentialKind.Installation
      : USER_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))
        ? EGithubCredentialKind.User
        : EGithubCredentialKind.Unknown

export const githubCallLane = (source: EGithubCallSource): EGithubCallLane =>
  BACKGROUND_SOURCES.has(source) ? EGithubCallLane.Background : EGithubCallLane.Essential
