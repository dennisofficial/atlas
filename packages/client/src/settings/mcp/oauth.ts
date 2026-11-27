import { EReturnResult, type ReturnOutcome } from '@dltech/atlas-core'
import {
  EMcpOauthGrantStatus,
  EMcpServerSource,
  type McpOauthScreen,
  type McpOauthServer,
} from '@dltech/atlas-wire/web'

import { relativeTimeOf } from '../relative-time'

export type McpOauthScope =
  | { readonly kind: 'user' }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'group'; readonly groupId: string }

export const mcpOauthServersInputOf = (
  scope: McpOauthScope,
): { projectId?: string; groupId?: string } => {
  if (scope.kind === 'project') return { projectId: scope.projectId }
  if (scope.kind === 'group') return { groupId: scope.groupId }
  return {}
}

export const mcpOauthScreenOf = (scope: McpOauthScope): McpOauthScreen => {
  if (scope.kind === 'project') return { kind: 'settings', scope: 'project', id: scope.projectId }
  if (scope.kind === 'group') return { kind: 'settings', scope: 'group', id: scope.groupId }
  return { kind: 'settings', scope: 'user' }
}

export enum EMcpAuthState {
  SignedIn = 'signed-in',
  SignIn = 'sign-in',
  SignInAgain = 'sign-in-again',
}

export const cloudServerOf = (
  servers: readonly McpOauthServer[],
  name: string,
): McpOauthServer | undefined =>
  servers.find((server) => server.source === EMcpServerSource.Cloud && server.name === name)

export const repoServersOf = <T extends McpOauthServer>(servers: readonly T[]): T[] =>
  servers.filter((server) => server.source === EMcpServerSource.Repo)

export const lastUsedOf = (args: {
  lastSeenAt: string | undefined
  now: number
}): string | undefined =>
  args.lastSeenAt === undefined
    ? undefined
    : relativeTimeOf({ iso: args.lastSeenAt, now: args.now })

export const authStateOf = (server: McpOauthServer | undefined): EMcpAuthState => {
  if (server === undefined) return EMcpAuthState.SignIn
  if (server.status === EMcpOauthGrantStatus.Connected) return EMcpAuthState.SignedIn
  if (server.status === EMcpOauthGrantStatus.Expired) return EMcpAuthState.SignInAgain
  return EMcpAuthState.SignIn
}

export const mcpServerLabelOf = (serverUrl: string): string =>
  URL.canParse(serverUrl) ? new URL(serverUrl).host : 'the server'

export type McpResultMessage = { ok: boolean; message: string }

export const mcpResultMessageOf = (args: {
  label: string
  outcome: ReturnOutcome
}): McpResultMessage => {
  if (args.outcome.result === EReturnResult.Connected)
    return { ok: true, message: `Signed in to ${args.label}` }
  const reason = args.outcome.reason
  const detail = reason === undefined || reason === '' ? '' : `: ${reason}`
  return { ok: false, message: `Couldn't sign in to ${args.label}${detail}` }
}
