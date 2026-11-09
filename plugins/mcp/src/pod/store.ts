import type { EDefinitionOrigin, ToolDefinition } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { McpServerChanged, McpServerRemoved } from '../core'
import type { LoadedMcpEntry, McpCloudRow, McpRejection } from '../core'
import { EMcpViewStatus, sameMcpRow, type McpServerRow } from '../core'
import { McpBridgeTool } from './bridge-tool'
import { fileReaderOf, loadMcpConfig } from './config'
import { HttpClient } from './http'
import { StdioClient } from './stdio'
import {
  McpTransportError,
  McpUnauthorizedError,
  messageOf,
  type McpCallResult,
  type McpToolInfo,
  type McpTransportClient,
} from './types'

export enum EMcpServerStatus {
  Connected = 'connected',
  Failed = 'failed',
  NeedsAuth = 'needs-auth',
}

export type McpServerState = {
  name: string
  origin: EDefinitionOrigin
  transport: 'stdio' | 'http' | null
  status: EMcpServerStatus
  tools: number
  reason: string | undefined
}

export type McpConfigPort = { rows(): Promise<readonly McpCloudRow[]> }

type Held = {
  spec: LoadedMcpEntry
  client: McpTransportClient
  status: EMcpServerStatus
  tools: readonly McpToolInfo[]
  reason: string | undefined
  instructions: string | undefined
}

const CONNECT_TIMEOUT_MS = 30_000

const RECONCILE_BUDGET_MS = 5_000

const reasonOf = (error: unknown): string => {
  if (error instanceof McpTransportError) return [error.message, ...error.stderr].join('\n').trim()
  return messageOf(error)
}

const withCeiling = async <T>(args: {
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

const withBudget = async (args: { ms: number; run: () => Promise<unknown> }): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, args.ms)
  })
  try {
    await Promise.race([args.run(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

const viewStatusOf = (status: EMcpServerStatus): EMcpViewStatus => {
  if (status === EMcpServerStatus.Connected) return EMcpViewStatus.Connected
  if (status === EMcpServerStatus.NeedsAuth) return EMcpViewStatus.NeedsAuth
  return EMcpViewStatus.Failed
}

const sameSpec = (left: LoadedMcpEntry, right: LoadedMcpEntry): boolean =>
  JSON.stringify([left.transport, left.disabled]) ===
  JSON.stringify([right.transport, right.disabled])

export class McpStore {
  private readonly held = new Map<string, Held>()
  private rejections: readonly McpRejection[] = []
  private published = new Map<string, McpServerRow>()
  private started = false

  constructor(
    private readonly args: {
      ctx: PluginPodContext
      repoDirectory: string | null
      config: McpConfigPort
      connectTimeoutMs: number
      reconcileBudgetMs: number
    },
  ) {}

  async boot(): Promise<void> {
    if (this.started) {
      await this.reconcile()
      return
    }
    this.started = true
    const merged = await this.load()
    this.rejections = merged.rejections
    await Promise.allSettled(merged.servers.map(async (spec) => await this.ensure(spec)))
    await this.publish()
  }

  async reconcile(): Promise<void> {
    const merged = await this.load()
    this.rejections = merged.rejections
    const wanted = new Set(merged.servers.map((spec) => spec.name))

    for (const [name, held] of [...this.held]) {
      if (wanted.has(name)) continue
      this.held.delete(name)
      await held.client.close()
    }

    await withBudget({
      ms: this.args.reconcileBudgetMs,
      run: async () => {
        await Promise.allSettled(merged.servers.map(async (spec) => await this.ensure(spec)))
      },
    })
    await this.publish()
  }

  tools(): readonly ToolDefinition[] {
    return [...this.held.values()]
      .filter((held) => held.status === EMcpServerStatus.Connected)
      .flatMap((held) =>
        held.tools.map(
          (info) =>
            new McpBridgeTool({
              server: held.spec.name,
              info,
              caller: () => this.callerOf(held.spec.name),
            }),
        ),
      )
  }

  servers(): readonly McpServerState[] {
    return [...this.held.values()].map((held) => ({
      name: held.spec.name,
      origin: held.spec.origin,
      transport: held.spec.transport?.kind ?? null,
      status: held.status,
      tools: held.tools.length,
      reason: held.reason,
    }))
  }

  rejectionsOf(): readonly McpRejection[] {
    return this.rejections
  }

  rows(): readonly McpServerRow[] {
    return this.servers().map((server) => ({
      name: server.name,
      transport: server.transport,
      status: viewStatusOf(server.status),
      toolCount: server.tools,
      ...(server.reason === undefined ? {} : { reason: server.reason }),
      layer: server.origin,
    }))
  }

  instructionsByServer(): Map<string, string> {
    const live = new Map<string, string>()
    for (const [name, held] of this.held) {
      if (held.status !== EMcpServerStatus.Connected) continue
      if (held.instructions === undefined || held.instructions.length === 0) continue
      live.set(name, held.instructions)
    }
    return live
  }

  instructionsOf(name: string): string | undefined {
    return this.held.get(name)?.instructions
  }

  async close(): Promise<void> {
    const held = [...this.held.values()]
    this.held.clear()
    await Promise.allSettled(held.map(async (entry) => await entry.client.close()))
  }

  private async publish(): Promise<void> {
    const rows = this.rows()
    const next = new Map(rows.map((row) => [row.name, row]))
    const drafts: (McpServerChanged | McpServerRemoved)[] = []
    for (const row of rows) {
      const kept = this.published.get(row.name)
      if (kept !== undefined && sameMcpRow(kept, row)) continue
      drafts.push({ type: 'mcp-server-changed', row })
    }
    for (const name of this.published.keys()) {
      if (next.has(name)) continue
      drafts.push({ type: 'mcp-server-removed', name })
    }
    this.published = next
    if (drafts.length === 0) return
    try {
      await this.args.ctx.append(drafts)
    } catch (error) {
      this.args.ctx.log(`mcp: recording the server roster failed: ${messageOf(error)}`)
    }
  }

  private async load() {
    return await loadMcpConfig({
      rows: await this.args.config.rows(),
      directory: this.args.repoDirectory,
      read: fileReaderOf({ call: (op) => this.args.ctx.call(op) }),
    })
  }

  private callerOf(
    name: string,
  ):
    | { name: string; call(args: { tool: string; input: unknown }): Promise<McpCallResult> }
    | undefined {
    const held = this.held.get(name)
    if (held === undefined || held.status !== EMcpServerStatus.Connected) return undefined
    return {
      name: held.spec.name,
      call: async (call) => {
        try {
          return await held.client.callTool({ name: call.tool, input: call.input })
        } catch (error) {
          held.status = EMcpServerStatus.Failed
          held.reason = reasonOf(error)
          throw error
        }
      },
    }
  }

  private async ensure(spec: LoadedMcpEntry): Promise<void> {
    const existing = this.held.get(spec.name)
    if (existing !== undefined && sameSpec(existing.spec, spec)) {
      if (existing.status === EMcpServerStatus.Connected) return
      await existing.client.close()
    } else if (existing !== undefined) {
      await existing.client.close()
    }

    const opened = await this.open(spec)
    this.held.set(spec.name, opened)
  }

  private async open(spec: LoadedMcpEntry): Promise<Held> {
    const transport = spec.transport
    if (transport === undefined) {
      return {
        spec,
        client: new HttpClient({
          serverId: spec.name,
          transport: { kind: 'http', url: 'http://localhost' },
        }),
        status: EMcpServerStatus.Failed,
        tools: [],
        reason: 'the server has no transport',
        instructions: undefined,
      }
    }

    const client: McpTransportClient =
      transport.kind === 'http'
        ? new HttpClient({ serverId: spec.name, transport })
        : new StdioClient({ ctx: this.args.ctx, serverId: spec.name, transport })

    try {
      const connection = await withCeiling({
        ms: this.args.connectTimeoutMs,
        message: `the '${spec.name}' MCP server did not answer initialize within ${this.args.connectTimeoutMs} ms`,
        run: () => client.connect(),
      })
      return {
        spec,
        client,
        status: EMcpServerStatus.Connected,
        tools: connection.tools,
        reason: undefined,
        instructions: connection.instructions,
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      return {
        spec,
        client,
        status:
          error instanceof McpUnauthorizedError
            ? EMcpServerStatus.NeedsAuth
            : EMcpServerStatus.Failed,
        tools: [],
        reason: reasonOf(error),
        instructions: undefined,
      }
    }
  }
}

export class McpStores {
  private readonly stores = new WeakMap<PluginPodContext, McpStore>()
  private readonly bySession = new Map<string, McpStore>()

  constructor(
    private readonly args: {
      repoDirectory: string | null
      config: McpConfigPort
      connectTimeoutMs?: number
      reconcileBudgetMs?: number
    },
  ) {}

  forSession(sessionId: string): McpStore | undefined {
    return this.bySession.get(sessionId)
  }

  of(ctx: PluginPodContext): McpStore {
    const kept = this.stores.get(ctx)
    if (kept !== undefined) return kept
    const store = new McpStore({
      ctx,
      repoDirectory: this.args.repoDirectory,
      config: this.args.config,
      connectTimeoutMs: this.args.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
      reconcileBudgetMs: this.args.reconcileBudgetMs ?? RECONCILE_BUDGET_MS,
    })
    this.stores.set(ctx, store)
    this.bySession.set(ctx.sessionId, store)
    return store
  }
}
