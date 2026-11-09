import { EStage } from '@dltech/atlas-core'
import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import type { McpCloudRow } from '../core'
import { McpStores, type McpConfigPort } from './store'

export { MCP_NAME_PREFIX } from './bridge-tool'
export { McpBridgeTool } from './bridge-tool'
export { loadMcpConfig } from './config'
export {
  EMcpServerStatus,
  McpStore,
  McpStores,
  type McpConfigPort,
  type McpServerState,
} from './store'
export { HttpClient } from './http'
export { StdioClient } from './stdio'
export type { McpCallResult, McpConnection, McpToolInfo, McpTransportClient } from './types'
export { McpTransportError, McpUnauthorizedError } from './types'

export type McpPodArgs = {
  repoDirectory: string | null
  config: McpConfigPort
  connectTimeoutMs?: number
  reconcileBudgetMs?: number
}

export const mcpCloudPort = (args: { rows(): Promise<readonly McpCloudRow[]> }): McpConfigPort =>
  args

export const mcpPod = (args: McpPodArgs): PodSlot => {
  const stores = new McpStores(args)
  return {
    ...EMPTY_POD,
    tools: (ctx) => stores.of(ctx).tools(),
    hooks: (ctx) => ({
      beforeTurn: [
        {
          name: 'mcp-connect',
          order: { stage: EStage.Observe, nudge: 10 },
          run: async () => {
            await stores.of(ctx).boot()
            return {}
          },
        },
      ],
    }),
  }
}
