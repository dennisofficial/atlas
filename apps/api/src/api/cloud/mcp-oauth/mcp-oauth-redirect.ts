import {
  EMcpOauthCallbackResult,
  MCP_OAUTH_REASON_PARAM,
  MCP_OAUTH_RESULT_PARAM,
  MCP_OAUTH_SERVER_PARAM,
} from '@dltech/atlas-wire'

export const DEFAULT_RETURN_TO = '/settings/integrations'

const MAX_REASON_LENGTH = 200

export function callbackRedirectOf(args: {
  webOrigin: string
  returnTo: string
  serverUrl?: string | undefined
  reason?: string | undefined
}): string {
  const webOrigin = new URL(args.webOrigin).origin
  let url = new URL(args.returnTo, webOrigin)
  if (url.origin !== webOrigin) url = new URL(DEFAULT_RETURN_TO, webOrigin)
  url.searchParams.set(
    MCP_OAUTH_RESULT_PARAM,
    args.reason === undefined ? EMcpOauthCallbackResult.Connected : EMcpOauthCallbackResult.Failed,
  )
  if (args.serverUrl !== undefined) url.searchParams.set(MCP_OAUTH_SERVER_PARAM, args.serverUrl)
  if (args.reason !== undefined) {
    url.searchParams.set(MCP_OAUTH_REASON_PARAM, args.reason.slice(0, MAX_REASON_LENGTH))
  }
  return url.toString()
}
