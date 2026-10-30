import type { McpOAuthFlow } from '../oauth/flow'

export interface McpTokenSource {
  currentToken(args: { serverUrl: string }): Promise<string | undefined>
  reject(args: { serverUrl: string; token: string }): void
  clearFailures?(): void
}

export const tokenSourceOfFlow = (flow: McpOAuthFlow): McpTokenSource => ({
  currentToken: ({ serverUrl }) => flow.currentToken({ serverUrl }),
  reject: () => undefined,
})
