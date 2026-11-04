import {
  DESKTOP_OPEN_HOST,
  DESKTOP_URL_SCHEME,
  EMcpOauthCallbackResult,
  EMcpOauthReturnSurface,
  MCP_OAUTH_REASON_PARAM,
  MCP_OAUTH_RESULT_PARAM,
  MCP_OAUTH_SERVER_PARAM,
} from '@dltech/atlas-wire'

export const DEFAULT_RETURN_TO = '/settings/integrations'

const MAX_REASON_LENGTH = 200

export const returnSurfaceOf = (value: string): EMcpOauthReturnSurface =>
  value === EMcpOauthReturnSurface.Desktop
    ? EMcpOauthReturnSurface.Desktop
    : EMcpOauthReturnSurface.Web

const webReturnOf = (args: { webOrigin: string; returnTo: string }): URL => {
  const webOrigin = new URL(args.webOrigin).origin
  const url = new URL(args.returnTo, webOrigin)
  return url.origin === webOrigin ? url : new URL(DEFAULT_RETURN_TO, webOrigin)
}

const desktopReturnOf = (web: URL): URL =>
  new URL(`${DESKTOP_URL_SCHEME}://${DESKTOP_OPEN_HOST}${web.pathname}${web.search}`)

export function callbackRedirectOf(args: {
  webOrigin: string
  returnTo: string
  surface?: EMcpOauthReturnSurface | undefined
  serverUrl?: string | undefined
  reason?: string | undefined
}): string {
  const web = webReturnOf(args)
  const url = args.surface === EMcpOauthReturnSurface.Desktop ? desktopReturnOf(web) : web
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
