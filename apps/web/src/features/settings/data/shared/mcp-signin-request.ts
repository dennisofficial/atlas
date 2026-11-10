export type McpSignInSurface = 'web' | 'desktop' | 'ios'

export type McpSignInScreen =
  | { kind: 'settings'; scope: 'user' }
  | { kind: 'settings'; scope: 'project'; id: string }

export type McpSignInArgs = {
  hostOrigin: string
  token: string
  serverId: string
  surface: McpSignInSurface
  screen: McpSignInScreen
}

export type McpSignInResult = { ok: true; url: string } | { ok: false; reason: string }

const isUrl = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const reasonOf = (body: unknown, status: number): string => {
  if (typeof body === 'object' && body !== null) {
    const reason = Reflect.get(body, 'reason')
    if (typeof reason === 'string' && reason.length > 0) return reason
  }
  return `the agent host answered ${status}`
}

export async function beginMcpSignIn(args: McpSignInArgs): Promise<McpSignInResult> {
  const response = await fetch(`${args.hostOrigin}/mcp-oauth/begin`, {
    method: 'POST',
    headers: { authorization: `Bearer ${args.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      serverId: args.serverId,
      surface: args.surface,
      screen: args.screen,
    }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) return { ok: false, reason: reasonOf(body, response.status) }
  const url = typeof body === 'object' && body !== null ? Reflect.get(body, 'url') : undefined
  return isUrl(url) ? { ok: true, url } : { ok: false, reason: 'the agent host sent no link' }
}
