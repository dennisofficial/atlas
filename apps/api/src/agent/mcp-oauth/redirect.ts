import type { McpReturnScreen, McpReturnSurface, McpReturnTarget } from './types'

export const DEFAULT_RETURN_TO = '/settings/integrations'

export const MCP_OAUTH_RESULT_PARAM = 'mcpOauth'
export const MCP_OAUTH_SERVER_PARAM = 'mcpServer'
export const MCP_OAUTH_REASON_PARAM = 'mcpReason'

export const DESKTOP_URL_SCHEME = 'atlas'
export const DESKTOP_OPEN_HOST = 'open'

const MAX_REASON_LENGTH = 200

const USER_SETTINGS_PATH = DEFAULT_RETURN_TO

const segment = (value: string): string => encodeURIComponent(value)

export const returnPathOf = (screen: McpReturnScreen): string => {
  if (screen.kind === 'session') return `/sessions/${segment(screen.id)}`
  if (screen.scope === 'project') return `/projects/${segment(screen.id)}/settings/mcp`
  return USER_SETTINGS_PATH
}

const webReturnOf = (args: { webOrigin: string; screen: McpReturnScreen }): URL =>
  new URL(returnPathOf(args.screen), new URL(args.webOrigin).origin)

const withResultParams = (args: {
  url: URL
  serverUrl?: string | undefined
  reason?: string | undefined
}): URL => {
  const url = new URL(args.url.toString())
  url.searchParams.set(MCP_OAUTH_RESULT_PARAM, args.reason === undefined ? 'connected' : 'failed')
  if (args.serverUrl !== undefined) url.searchParams.set(MCP_OAUTH_SERVER_PARAM, args.serverUrl)
  if (args.reason !== undefined) {
    url.searchParams.set(MCP_OAUTH_REASON_PARAM, args.reason.slice(0, MAX_REASON_LENGTH))
  }
  return url
}

export const webCallbackUrlOf = (args: {
  webOrigin: string
  screen: McpReturnScreen
  serverUrl?: string | undefined
  reason?: string | undefined
}): string =>
  withResultParams({
    url: webReturnOf({ webOrigin: args.webOrigin, screen: args.screen }),
    serverUrl: args.serverUrl,
    reason: args.reason,
  }).toString()

const desktopDeepLinkOf = (url: URL): string =>
  `${DESKTOP_URL_SCHEME}://${DESKTOP_OPEN_HOST}${url.pathname}${url.search}`

const iosDeepLinkOf = (url: URL): string => `${DESKTOP_URL_SCHEME}://${url.pathname}${url.search}`

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const scriptLiteral = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('<', '\\u003c')}"`

const pageOf = (args: { deepLink: string; webUrl: string; reason: string | undefined }): string => {
  const outcome =
    args.reason === undefined
      ? 'Signed in. Continue in Atlas to use the server.'
      : `Couldn't finish the sign-in: ${args.reason}.`
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Continue in Atlas</title></head>',
    '<body style="margin:0;padding:2.5rem;font:16px/1.5 system-ui,sans-serif;color:#1c1c1c">',
    `<p>${escapeHtml(outcome)}</p>`,
    `<p><a href="${escapeHtml(args.deepLink)}">Open Atlas</a></p>`,
    `<p><a href="${escapeHtml(args.webUrl)}">Continue in the browser</a></p>`,
    `<script>location.href = ${scriptLiteral(args.deepLink)}</script>`,
    '</body></html>',
  ].join('')
}

export type CallbackAnswer = { kind: 'redirect'; location: string } | { kind: 'page'; html: string }

export const DEFAULT_RETURN_TARGET: McpReturnTarget = {
  surface: 'web',
  screen: { kind: 'settings', scope: 'user' },
}

export const callbackAnswerOf = (args: {
  webOrigin: string
  target: McpReturnTarget
  serverUrl?: string | undefined
  reason?: string | undefined
}): CallbackAnswer => {
  const webUrl = withResultParams({
    url: webReturnOf({ webOrigin: args.webOrigin, screen: args.target.screen }),
    serverUrl: args.serverUrl,
    reason: args.reason,
  })
  const staysInBrowser =
    args.target.surface === 'web' ||
    (args.target.surface === 'ios' && args.target.screen.kind !== 'session')
  if (staysInBrowser) return { kind: 'redirect', location: webUrl.toString() }
  const deepLink =
    args.target.surface === 'desktop' ? desktopDeepLinkOf(webUrl) : iosDeepLinkOf(webUrl)
  return {
    kind: 'page',
    html: pageOf({ deepLink, webUrl: webUrl.toString(), reason: args.reason }),
  }
}

export const surfaceOf = (value: string | null | undefined): McpReturnSurface =>
  value === 'desktop' || value === 'ios' ? value : 'web'
