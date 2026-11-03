import type { EDefinitionOrigin } from '@dltech/atlas-core'

import type { McpOAuthFlow } from '../oauth/flow'

export type McpTokenTarget = { name: string; url: string; origin: EDefinitionOrigin }

export interface McpTokenSource {
  currentToken(args: { server: McpTokenTarget }): Promise<string | undefined>
  reject(args: { server: McpTokenTarget; token: string }): void
  clearFailures?(): void
}

export const tokenSourceOfFlow = (flow: McpOAuthFlow): McpTokenSource => ({
  currentToken: ({ server }) => flow.currentToken({ serverUrl: server.url }),
  reject: () => undefined,
})
