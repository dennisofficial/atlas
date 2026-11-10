import type { CommandHandler } from '@dltech/atlas-commands'
import { EStage, type ThreadId } from '@dltech/atlas-core'
import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { mcpCommand } from '../core'
import type { McpConfigPort } from './config'
import { mcpInstructionsHook } from './instructions'
import { mcpReport } from './report'
import { McpStores } from './store'

export { MCP_NAME_PREFIX } from './bridge-tool'
export { McpBridgeTool } from './bridge-tool'
export { mcpInstructionsHook, mcpInstructionsOf } from './instructions'
export { mcpReport, mcpReportRow, NO_MCP_SERVERS } from './report'
export { loadMcpConfig, type McpCloudRead, type McpConfigPort } from './config'
export { EMcpServerStatus, McpStore, McpStores, type McpServerState } from './store'
export { HttpClient } from './http'
export { StdioClient } from './stdio'
export type { McpCallResult, McpConnection, McpToolInfo, McpTransportClient } from './types'
export { McpTransportError, McpUnauthorizedError } from './types'

export type McpPodArgs = {
  config: McpConfigPort
  connectTimeoutMs?: number
  reconcileBudgetMs?: number
}

export const mcpCloudPort = (args: McpConfigPort): McpConfigPort => args

export const mcpPod = (args: McpPodArgs): PodSlot => {
  const stores = new McpStores(args)
  const offered = new Map<ThreadId, Set<string>>()
  const report: CommandHandler<unknown> = async (context) => {
    const store = stores.forSession(context.sessionId)
    if (store === undefined) {
      return {
        kind: 'refused',
        reason: 'this session has not started its MCP servers yet; send a message first',
      }
    }
    await context.append([
      { type: 'assistant-said', parts: [{ type: 'text', text: mcpReport(store.rows()) }] },
    ])
    return { kind: 'done' }
  }
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
        mcpInstructionsHook({ store: stores.of(ctx), offered }),
      ],
    }),
    commands: new Map([[mcpCommand.inboxKind, report]]),
  }
}
