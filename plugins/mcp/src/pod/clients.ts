import { MacOfflineError, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { LoadedMcpEntry } from '../core'
import { HttpClient } from './http'
import { ProxyClient } from './proxy'
import { specHashOf } from './sanitize'
import { EMcpServerStatus } from './snapshot'
import { StdioClient } from './stdio'
import {
  McpTransportError,
  McpUnauthorizedError,
  messageOf,
  type McpToolInfo,
  type McpTransportClient,
} from './types'

export const CONNECT_TIMEOUT_MS = 30_000

const ID_DISALLOWED = /[^A-Za-z0-9_.:-]/g

export const serverIdOf = (args: { sessionId: string; name: string }): string =>
  `${args.sessionId}.${args.name}`.replace(ID_DISALLOWED, '-')

export const reasonOf = (error: unknown): string =>
  error instanceof McpTransportError
    ? [error.message, ...error.stderr].join('\n').trim()
    : messageOf(error)

export const withCeiling = async <T>(args: {
  ms: number
  message: string
  run: () => Promise<T>
}): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpTransportError(args.message)), args.ms)
  })
  try {
    return await Promise.race([args.run(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

const tokenOf = async (args: {
  ctx: PluginPodContext
  entry: LoadedMcpEntry
}): Promise<string | undefined> => {
  const transport = args.entry.transport
  if (transport?.kind !== 'http') return undefined
  try {
    return await args.ctx.control.mcp.token({
      name: args.entry.name,
      source: args.entry.source,
      url: transport.url,
    })
  } catch {
    return undefined
  }
}

export const openClient = async (args: {
  ctx: PluginPodContext
  entry: LoadedMcpEntry
  onExit?: (reason: string) => void
}): Promise<McpTransportClient | null> => {
  const { entry, ctx } = args
  const transport = entry.transport
  if (transport === undefined) return null
  if (entry.proxy === true) {
    return new ProxyClient({
      control: ctx.control.mcp,
      serverId: entry.name,
      transport,
      ...(args.onExit === undefined ? {} : { onClosed: args.onExit }),
    })
  }
  if (transport.kind === 'http') {
    const token = entry.accessToken ?? (await tokenOf({ ctx, entry }))
    return new HttpClient({
      serverId: entry.name,
      transport,
      ...(token === undefined ? {} : { accessToken: token }),
    })
  }
  return new StdioClient({
    ctx,
    serverId: serverIdOf({ sessionId: ctx.sessionId, name: entry.name }),
    transport,
    specHash: specHashOf(entry),
    ...(args.onExit === undefined ? {} : { onExit: args.onExit }),
  })
}

export type McpOpen = {
  client: McpTransportClient | null
  status: EMcpServerStatus
  tools: readonly McpToolInfo[]
  instructions: string | undefined
  reason: string | undefined
}

export const connectOf = async (args: {
  ctx: PluginPodContext
  entry: LoadedMcpEntry
  timeoutMs: number
  onExit?: (reason: string) => void
}): Promise<McpOpen> => {
  const client = await openClient({
    ctx: args.ctx,
    entry: args.entry,
    ...(args.onExit === undefined ? {} : { onExit: args.onExit }),
  })
  if (client === null) {
    return {
      client,
      status: EMcpServerStatus.Failed,
      tools: [],
      instructions: undefined,
      reason: 'the server has no transport',
    }
  }
  try {
    const connection = await withCeiling({
      ms: args.timeoutMs,
      message: `the '${args.entry.name}' MCP server did not answer initialize within ${args.timeoutMs} ms`,
      run: () => client.connect(),
    })
    return {
      client,
      status: EMcpServerStatus.Connected,
      tools: connection.tools,
      instructions: connection.instructions,
      reason: undefined,
    }
  } catch (error) {
    await client.close().catch(() => undefined)
    return {
      client,
      status:
        error instanceof MacOfflineError
          ? EMcpServerStatus.Unavailable
          : error instanceof McpUnauthorizedError
            ? EMcpServerStatus.NeedsAuth
            : EMcpServerStatus.Failed,
      tools: [],
      instructions: undefined,
      reason: reasonOf(error),
    }
  }
}

export class McpClients {
  private readonly byCtx = new WeakMap<PluginPodContext, Map<string, Promise<McpTransportClient>>>()

  constructor(private readonly args: { timeoutMs?: number | undefined } = {}) {}

  async clientFor(
    entryOf: () => Promise<LoadedMcpEntry>,
    ctx: PluginPodContext,
  ): Promise<McpTransportClient> {
    const held = this.byCtx.get(ctx) ?? new Map<string, Promise<McpTransportClient>>()
    this.byCtx.set(ctx, held)
    const entry = await entryOf()
    const kept = held.get(entry.name)
    if (kept !== undefined) return await kept
    const opening = this.open(ctx, entry)
    held.set(entry.name, opening)
    try {
      return await opening
    } catch (error) {
      held.delete(entry.name)
      throw error
    }
  }

  private async open(ctx: PluginPodContext, entry: LoadedMcpEntry): Promise<McpTransportClient> {
    const opened = await connectOf({
      ctx,
      entry,
      timeoutMs: this.args.timeoutMs ?? CONNECT_TIMEOUT_MS,
    })
    if (opened.client === null || opened.status !== EMcpServerStatus.Connected) {
      throw new McpTransportError(
        opened.reason ?? `the '${entry.name}' MCP server is not connected`,
      )
    }
    return opened.client
  }
}
