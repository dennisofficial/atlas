export enum EMcpSignInSurface {
  Web = 'web',
  Desktop = 'desktop',
  Ios = 'ios',
}

export const MCP_SIGN_IN_START_PATH = '/mcp-oauth/start'
export const MCP_SIGN_IN_SURFACE_PARAM = 'surface'

export const signInSurfaceOf = (value: string | null | undefined): EMcpSignInSurface | undefined =>
  Object.values(EMcpSignInSurface).find((surface) => surface === value)

export const signInStartUrlOf = (args: { publicUrl: string; state: string }): string =>
  `${new URL(args.publicUrl).origin}${MCP_SIGN_IN_START_PATH}/${encodeURIComponent(args.state)}`

const isStartUrl = (url: URL): boolean => url.pathname.startsWith(`${MCP_SIGN_IN_START_PATH}/`)

export const signInUrlFor = (args: { url: string; surface: EMcpSignInSurface }): string => {
  let parsed: URL
  try {
    parsed = new URL(args.url)
  } catch {
    return args.url
  }
  if (!isStartUrl(parsed)) return args.url
  parsed.searchParams.set(MCP_SIGN_IN_SURFACE_PARAM, args.surface)
  return parsed.toString()
}

export type SignInSurfaceCookie = { state: string; surface: EMcpSignInSurface }

export const returnSurfaceOf = (args: {
  state: string
  cookie: SignInSurfaceCookie | undefined
  recorded: EMcpSignInSurface
}): EMcpSignInSurface =>
  args.cookie !== undefined && args.cookie.state === args.state
    ? args.cookie.surface
    : args.recorded
