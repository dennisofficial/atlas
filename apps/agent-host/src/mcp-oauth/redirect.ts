export const DEFAULT_RETURN_TO = '/settings/integrations'

export const MCP_OAUTH_RESULT_PARAM = 'mcpOauth'
export const MCP_OAUTH_SERVER_PARAM = 'mcpServer'
export const MCP_OAUTH_REASON_PARAM = 'mcpReason'

const MAX_REASON_LENGTH = 200

const webReturnOf = (args: { webOrigin: string; returnTo: string }): URL => {
  const webOrigin = new URL(args.webOrigin).origin
  const url = new URL(args.returnTo, webOrigin)
  return url.origin === webOrigin ? url : new URL(DEFAULT_RETURN_TO, webOrigin)
}

export const callbackRedirectOf = (args: {
  webOrigin: string
  returnTo: string
  serverUrl?: string | undefined
  reason?: string | undefined
}): string => {
  const url = webReturnOf(args)
  url.searchParams.set(MCP_OAUTH_RESULT_PARAM, args.reason === undefined ? 'connected' : 'failed')
  if (args.serverUrl !== undefined) url.searchParams.set(MCP_OAUTH_SERVER_PARAM, args.serverUrl)
  if (args.reason !== undefined) {
    url.searchParams.set(MCP_OAUTH_REASON_PARAM, args.reason.slice(0, MAX_REASON_LENGTH))
  }
  return url.toString()
}
