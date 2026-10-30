import {
  EMcpOauthCallbackResult,
  EMcpOauthGrantStatus,
  MCP_OAUTH_REASON_PARAM,
  MCP_OAUTH_RESULT_PARAM,
  MCP_OAUTH_SERVER_PARAM,
  type McpOauthGrant,
} from '@dltech/atlas-wire/web'

import { ELinkReturnKind, type LinkReturn } from '../personal/link-return'

export enum EMcpAuthState {
  SignedIn = 'signed-in',
  SignIn = 'sign-in',
  SignInAgain = 'sign-in-again',
}

export type McpOauthSubject = {
  id: string
  enabled: boolean
  signInUrl?: string
}

const AUTHORIZATION_HEADER = 'authorization'

export const signInUrlOf = (args: {
  url: string
  headers: Record<string, string> | undefined
}): string | undefined => {
  const hasAuthorization = Object.keys(args.headers ?? {}).some(
    (name) => name.toLowerCase() === AUTHORIZATION_HEADER,
  )
  return hasAuthorization ? undefined : args.url
}

const isHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'https:' || protocol === 'http:'
}

export const statusUrlsOf = (servers: readonly McpOauthSubject[]): string[] => {
  const urls = servers.flatMap((server) =>
    server.enabled && server.signInUrl !== undefined && isHttpUrl(server.signInUrl)
      ? [server.signInUrl]
      : [],
  )
  return [...new Set(urls)].sort()
}

export const authStateOf = (args: {
  signInUrl: string | undefined
  grants: readonly McpOauthGrant[]
}): EMcpAuthState | undefined => {
  if (args.signInUrl === undefined) return undefined
  const grant = args.grants.find((entry) => entry.serverUrl === args.signInUrl)
  if (grant === undefined) return undefined
  if (grant.status === EMcpOauthGrantStatus.Connected) return EMcpAuthState.SignedIn
  if (grant.status === EMcpOauthGrantStatus.Expired) return EMcpAuthState.SignInAgain
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
