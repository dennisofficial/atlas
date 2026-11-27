import { EMcpOauthBeginOutcome } from '@dltech/atlas-wire/web'

import { api } from '@/lib/api-client'

export type McpSignInScreen =
  | { kind: 'settings'; scope: 'user' }
  | { kind: 'settings'; scope: 'project'; id: string }
  | { kind: 'settings'; scope: 'group'; id: string }

export type McpSignInArgs = {
  serverId: string
  screen: McpSignInScreen
}

export type McpSignInResult = { ok: true; url: string } | { ok: false; reason: string }

const UNREACHABLE = 'the api could not begin the sign-in'

export async function beginMcpSignIn(args: McpSignInArgs): Promise<McpSignInResult> {
  try {
    const result = await api.mcpOauth.begin.mutate({
      serverId: args.serverId,
      screen: args.screen,
    })
    return result.outcome === EMcpOauthBeginOutcome.Redirect
      ? { ok: true, url: result.authorizationUrl }
      : { ok: false, reason: result.reason }
  } catch {
    return { ok: false, reason: UNREACHABLE }
  }
}
