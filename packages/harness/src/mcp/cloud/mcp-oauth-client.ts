import { createHarnessApiClient } from '../../cloud/api-trpc-client'
import type { CloudSession } from '../../cloud/cloud-session'
import type { McpOauthAccessCall } from './cloud-mcp-token-source'

const ACCESS_TIMEOUT_MS = 15_000

export const mcpOauthAccessCall = (args: {
  session: CloudSession
  clientVersion: string
  fetchFn?: typeof fetch | undefined
}): McpOauthAccessCall => {
  const api = createHarnessApiClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn ?? fetch,
    timeoutMs: null,
  })
  return (input) =>
    api.mcpOauth.accessToken.mutate(input, { signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS) })
}
