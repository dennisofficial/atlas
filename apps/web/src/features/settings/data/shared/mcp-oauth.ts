import {
  EMcpOauthCallbackResult,
  EMcpOauthGrantStatus,
  EMcpServerSource,
  MCP_OAUTH_REASON_PARAM,
  MCP_OAUTH_RESULT_PARAM,
  MCP_OAUTH_SERVER_PARAM,
  type McpOauthServer,
} from '@dltech/atlas-wire/web'

import { ELinkReturnKind, type LinkReturn } from '../personal/link-return'
import { relativeTimeOf } from './relative-time'

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

const hostOf = (serverUrl: string | null): string =>
  serverUrl !== null && URL.canParse(serverUrl) ? new URL(serverUrl).host : 'the server'

export const MCP_OAUTH_RETURN_PARAMS = [
  MCP_OAUTH_RESULT_PARAM,
  MCP_OAUTH_SERVER_PARAM,
  MCP_OAUTH_REASON_PARAM,
]

export function mcpOauthReturnOf(params: URLSearchParams): LinkReturn | null {
  const result = params.get(MCP_OAUTH_RESULT_PARAM)
  const host = hostOf(params.get(MCP_OAUTH_SERVER_PARAM))
  if (result === EMcpOauthCallbackResult.Connected) {
    return { kind: ELinkReturnKind.Success, message: `Signed in to ${host}` }
  }
  if (result !== EMcpOauthCallbackResult.Failed) return null
  const reason = params.get(MCP_OAUTH_REASON_PARAM)
  const detail = reason === null || reason === '' ? '' : `: ${reason}`
  return {
    kind: ELinkReturnKind.Error,
    message: `Couldn't sign in to ${host}${detail}`,
  }
}
