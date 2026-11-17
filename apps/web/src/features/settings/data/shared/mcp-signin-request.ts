import { EMcpOauthBeginOutcome, EMcpOauthReturnSurface } from '@dltech/atlas-wire/web'

import { api } from '@/lib/api-client'

export type McpSignInSurface = 'web' | 'desktop' | 'ios'

export type McpSignInScreen =
  | { kind: 'settings'; scope: 'user' }
  | { kind: 'settings'; scope: 'project'; id: string }

export type McpSignInArgs = {
  serverId: string
  surface: McpSignInSurface
  screen: McpSignInScreen
}

export type McpSignInResult = { ok: true; url: string } | { ok: false; reason: string }

const UNREACHABLE = 'the api could not begin the sign-in'

export async function beginMcpSignIn(args: McpSignInArgs): Promise<McpSignInResult> {
  try {
    const result = await api.mcpOauth.begin.mutate({
      serverId: args.serverId,
      surface:
        args.surface === 'desktop' ? EMcpOauthReturnSurface.Desktop : EMcpOauthReturnSurface.Web,
      screen: args.screen,
    })
    return result.outcome === EMcpOauthBeginOutcome.Redirect
      ? { ok: true, url: result.authorizationUrl }
      : { ok: false, reason: result.reason }
  } catch {
    return { ok: false, reason: UNREACHABLE }
  }
}
