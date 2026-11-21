import type { CommandHandler } from '@dltech/atlas-commands'
import {
  EMPTY_POD,
  readResource,
  type PluginPodContext,
  type PodResource,
  type PodSlot,
} from '@dltech/atlas-plugin-sdk'

import { mcpCommand, mcpRosterOfEvents, type LoadedMcpEntry } from '../core'
import { McpClients } from './clients'
import type { McpConfigPort } from './config'
import { mcpDeferredListingHook } from './deferred-listing'
import { mcpReport } from './report'
import { mcpConfigResource, mcpToolsResource, resolveMcpServers } from './resources'
import { rowsOf } from './roster'
import { McpSignInBook } from './sign-in-book'
import { McpSignInTool } from './sign-in'
import { CONNECT_TIMEOUT_MS } from './clients'
import { bridgeToolsOf } from './tools-of'
import { McpTransportError } from './types'

export { MCP_NAME_PREFIX, McpBridgeTool } from './bridge-tool'
export { mcpDeferredListingHook } from './deferred-listing'
export { mcpInstructionsDraftsOf } from './instructions'
export { mcpReport, mcpReportRow, NO_MCP_SERVERS } from './report'
export { mcpRosterDraftsOf, rowsOf } from './roster'
export {
  MCP_CONFIG,
  MCP_TOOLS,
  mcpConfigResource,
  mcpToolsResource,
  resolveMcpServers,
} from './resources'
export { McpSignInTool } from './sign-in'
export { loadMcpConfig, type McpCloudRead, type McpConfigPort } from './config'
export {
  EMcpServerStatus,
  hashOf,
  mcpConfigSnapshotSchema,
  mcpToolsSnapshotSchema,
  type McpConfigSnapshot,
  type McpConfiguredServer,
  type McpServerTools,
  type McpToolsSnapshot,
} from './snapshot'
export { McpClients, serverIdOf } from './clients'
export { HttpClient } from './http'
export { ProxyClient } from './proxy'
export { StdioClient } from './stdio'
export type { McpCallResult, McpConnection, McpToolInfo, McpTransportClient } from './types'
export { McpTransportError, McpUnauthorizedError } from './types'

export type McpPodArgs = {
  config: McpConfigPort
  connectTimeoutMs?: number
}

export const mcpCloudPort = (args: McpConfigPort): McpConfigPort => args

export const mcpPod = (args: McpPodArgs): PodSlot => {
  const connectTimeoutMs = args.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  const signIns = new McpSignInBook()
  const clients = new McpClients({ timeoutMs: connectTimeoutMs })
  const config: PodResource<import('./snapshot').McpConfigSnapshot> = mcpConfigResource(args)
  const tools: PodResource<import('./snapshot').McpToolsSnapshot> = mcpToolsResource({
    config: args.config,
    connectTimeoutMs,
    signIns,
  })

  const entryOf = async (lookup: {
    ctx: PluginPodContext
    name: string
    directory: string | undefined
  }): Promise<LoadedMcpEntry> => {
    if (lookup.directory === undefined)
      throw new McpTransportError(`the '${lookup.name}' MCP server has no recorded configuration`)
    const merged = await resolveMcpServers({
      ctx: lookup.ctx,
      config: args.config,
      directory: lookup.directory,
    })
    const entry = merged.servers.find((candidate) => candidate.name === lookup.name)
    if (entry === undefined)
      throw new McpTransportError(`the '${lookup.name}' MCP server is no longer configured`)
    return entry
  }

  const report: CommandHandler<unknown> = async (context) => {
    const rows = mcpRosterOfEvents(context.visibleEvents())
    await context.append([
      { type: 'assistant-said', parts: [{ type: 'text', text: mcpReport(rows) }] },
    ])
    return { kind: 'done' }
  }

  return {
    ...EMPTY_POD,
    resources: [config, tools],
    tools: (ctx) => {
      const snapshot = readResource({ ctx, resource: tools })
      return [
        ...bridgeToolsOf({
          snapshot,
          call: async (server, call) => {
            const entry = await entryOf({ ctx, name: server, directory: snapshot?.directory })
            const client = await clients.clientFor(async () => entry, ctx)
            return await client.callTool({ name: call.tool, input: call.input })
          },
        }),
        new McpSignInTool({ ctx, resource: config, signIns }),
      ]
    },
    hooks: (ctx) => ({
      beforeStep: [
        mcpDeferredListingHook({ snapshot: () => readResource({ ctx, resource: tools }) }),
      ],
    }),
    commands: new Map([[mcpCommand.inboxKind, report]]),
  }
}

export const mcpRosterRows = rowsOf
