import {
  mcpSignInResultOf,
  unreachableSignInResult,
  type McpSignInScreen,
} from '@dltech/atlas-client/settings'

import { api } from '@/lib/api-client'

export type { McpSignInScreen }

export type McpSignInArgs = {
  serverId: string
  screen: McpSignInScreen
}

export type McpSignInResult = { ok: true; url: string } | { ok: false; reason: string }

export async function beginMcpSignIn(args: McpSignInArgs): Promise<McpSignInResult> {
  try {
    const result = await api.mcpOauth.begin.mutate({
      serverId: args.serverId,
      screen: args.screen,
    })
    return mcpSignInResultOf(result)
  } catch {
    return unreachableSignInResult()
  }
}
