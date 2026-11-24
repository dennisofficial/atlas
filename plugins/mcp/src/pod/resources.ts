import { latestResourceOf, type EventDraft, type PluginEventBody } from '@dltech/atlas-core'
import {
  ECloudSetting,
  readResource,
  type PluginPodContext,
  type PodResource,
  type ResourceWatch,
} from '@dltech/atlas-plugin-sdk'

import type { MergedMcp } from '../core'
import { connectOf, serverIdOf, type McpOpen } from './clients'
import { fileReaderOf, loadMcpConfig, type McpConfigPort } from './config'
import { mcpInstructionsDraftsOf } from './instructions'
import { mcpRosterDraftsOf, rowsOf } from './roster'
import { configHashOf, configuredServerOf } from './sanitize'
import type { McpSignInBook } from './sign-in-book'
import {
  EMcpServerStatus,
  hashOfServers,
  mcpConfigSnapshotSchema,
  mcpToolsSnapshotSchema,
  type McpConfigSnapshot,
  type McpServerTools,
  type McpToolsSnapshot,
} from './snapshot'
import { StdioClient } from './stdio'

export const MCP_CONFIG = 'mcp-config'

export const MCP_TOOLS = 'mcp-tools'

const WATCH_BASENAMES = ['.mcp.json', 'mcp.json'] as const

export const mcpWatchOf = (directory: string): ResourceWatch => ({
  roots: [directory, `${directory}/.atlas`],
  basenames: [...WATCH_BASENAMES],
})

export const resolveMcpServers = async (args: {
  ctx: PluginPodContext
  config: McpConfigPort
  directory: string
}): Promise<MergedMcp> =>
  await loadMcpConfig({
    cloud: await args.config.read({ sessionId: args.ctx.sessionId }),
    directory: args.directory,
    read: fileReaderOf({ call: (op) => args.ctx.call(op) }),
  })

const releaseOf = async (opened: McpOpen): Promise<void> => {
  const client = opened.client
  if (client === null) return
  if (client instanceof StdioClient) {
    client.detach()
    return
  }
  await client.close().catch(() => undefined)
}

export const mcpConfigResource = (args: {
  config: McpConfigPort
}): PodResource<McpConfigSnapshot> => ({
  name: MCP_CONFIG,
  schema: mcpConfigSnapshotSchema,
  watch: mcpWatchOf,
  cloud: [ECloudSetting.McpServers],
  load: async ({ ctx, directory }) => {
    const merged = await resolveMcpServers({ ctx, config: args.config, directory })
    const servers = merged.servers.map(configuredServerOf)
    return {
      servers,
      rejections: merged.rejections,
      hash: hashOfServers(servers.map((server) => server.configHash)),
    }
  },
})

const previousToolsOf = (ctx: PluginPodContext): McpToolsSnapshot | undefined => {
  const latest = latestResourceOf({ events: ctx.events(), resource: MCP_TOOLS })
  if (latest === undefined) return undefined
  const parsed = mcpToolsSnapshotSchema.safeParse(latest.value)
  return parsed.success ? parsed.data : undefined
}

const carriedOf = (args: {
  previous: McpToolsSnapshot | undefined
  name: string
  configHash: string
}): McpServerTools | undefined => {
  const kept = (args.previous?.servers ?? []).find(
    (server) => server.name === args.name && server.configHash === args.configHash,
  )
  return kept === undefined ? undefined : { ...kept, retry: true }
}

export const mcpToolsResource = (args: {
  config: McpConfigPort
  connectTimeoutMs: number
  signIns: McpSignInBook
}): PodResource<McpToolsSnapshot> => ({
  name: MCP_TOOLS,
  schema: mcpToolsSnapshotSchema,
  watch: mcpWatchOf,
  cloud: [ECloudSetting.McpServers],
  background: true,
  stale: (value) => value.servers.some((server) => server.retry === true),
  announce: (value, ctx): readonly (EventDraft | PluginEventBody)[] => {
    const rows = rowsOf(value)
    const previous = previousToolsOf(ctx)
    return [
      ...mcpRosterDraftsOf({ previous: rowsOf(previous), next: rows }),
      ...mcpInstructionsDraftsOf({ events: ctx.events(), servers: value.servers }),
      ...args.signIns.resolutionsOf({ sessionId: ctx.sessionId, rows, now: Date.now() }),
    ]
  },
  load: async ({ ctx, directory }) => {
    const merged = await resolveMcpServers({ ctx, config: args.config, directory })
    const previous = previousToolsOf(ctx)
    const servers = await Promise.all(
      merged.servers.map(async (entry): Promise<McpServerTools> => {
        const opened = await connectOf({
          ctx,
          entry,
          timeoutMs: args.connectTimeoutMs,
        })
        await releaseOf(opened)
        const configHash = configHashOf(entry)
        const kept = opened.retry
          ? carriedOf({ previous, name: entry.name, configHash })
          : undefined
        if (kept !== undefined) return kept
        return {
          name: entry.name,
          origin: entry.origin,
          transportKind: entry.transport?.kind ?? null,
          configHash,
          status: opened.status,
          tools: opened.tools,
          ...(opened.reason === undefined ? {} : { reason: opened.reason }),
          ...(opened.instructions === undefined ? {} : { instructions: opened.instructions }),
          ...(opened.retry ? { retry: true } : {}),
        }
      }),
    )
    return {
      configHash: hashOfServers(servers.map((server) => server.configHash)),
      directory,
      servers,
    }
  },
})

export const toolsSnapshotOf = (args: {
  ctx: PluginPodContext
  resource: PodResource<McpToolsSnapshot>
}): McpToolsSnapshot | undefined => readResource(args)

export const connectedServersOf = (
  snapshot: McpToolsSnapshot | undefined,
): readonly McpServerTools[] =>
  (snapshot?.servers ?? []).filter((server) => server.status === EMcpServerStatus.Connected)

export const serverIdFor = (args: { ctx: PluginPodContext; name: string }): string =>
  serverIdOf({ sessionId: args.ctx.sessionId, name: args.name })
