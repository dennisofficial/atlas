import type { ToolDefinition } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { McpServerChanged, McpServerRemoved } from '../core'
import type { LoadedMcpEntry, McpRejection } from '../core'
import {
  EMcpViewStatus,
  sameMcpRow,
  type McpServerRow,
  type McpSignInResolved,
  type OutstandingSignIn,
} from '../core'
import { bridgeNameOf, McpBridgeTool } from './bridge-tool'
import { McpSignInBook } from './sign-in-book'
import { fileReaderOf, loadMcpConfig, type McpConfigPort } from './config'
import { openHeld, sameSpec, withBudget, type Held } from './connect'
import { EMcpServerStatus, reasonOf, viewStatusOf, type McpServerState } from './server-status'
import { messageOf, type McpCallResult, type McpTransportClient } from './types'

export { EMcpServerStatus, type McpServerState } from './server-status'

export class McpStore {
  private readonly held = new Map<string, Held>()
  private rejections: readonly McpRejection[] = []
  private published = new Map<string, McpServerRow>()
  private readonly signIns = new McpSignInBook()
  private started = false
  private reconciling: Promise<void> | null = null
  private rerun = false

  constructor(
    private readonly args: {
      ctx: PluginPodContext
      config: McpConfigPort
      connectTimeoutMs: number
      reconcileBudgetMs: number
    },
  ) {}

  async boot(): Promise<void> {
    if (this.started) {
      this.refresh()
      return
    }
    this.started = true
    const merged = await this.load()
    this.rejections = merged.rejections
    await Promise.allSettled(merged.servers.map(async (spec) => await this.ensure(spec)))
    await this.publish()
  }

  refresh(): void {
    if (this.reconciling !== null) {
      this.rerun = true
      return
    }
    this.reconciling = this.drainRefreshes().finally(() => {
      this.reconciling = null
    })
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

    const ensured = Promise.allSettled(merged.servers.map(async (spec) => await this.ensure(spec)))
    await withBudget({ ms: this.args.reconcileBudgetMs, run: async () => await ensured })
    await this.publish()
    await ensured
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
    return [
      ...this.servers().map((server) => ({
        name: server.name,
        transport: server.transport,
        status: viewStatusOf(server.status),
        toolCount: server.tools,
        ...(server.reason === undefined ? {} : { reason: server.reason }),
        layer: server.origin,
      })),
      ...this.rejections.map((rejection) => ({
        name: rejection.name ?? rejection.definedIn,
        transport: null,
        status: EMcpViewStatus.Failed,
        toolCount: 0,
        reason: rejection.detail,
        layer: rejection.origin,
      })),
    ]
  }

  toolNamesByServer(): Map<string, readonly string[]> {
    const groups = new Map<string, readonly string[]>()
    for (const held of this.held.values()) {
      if (held.status !== EMcpServerStatus.Connected) continue
      groups.set(
        held.spec.name,
        held.tools.map((info) => bridgeNameOf(held.spec.name, info.name)),
      )
    }
    return groups
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

  noteSignInStarted(pending: OutstandingSignIn): void {
    this.signIns.note(pending)
  }

  specOf(name: string): LoadedMcpEntry | undefined {
    return this.held.get(name)?.spec
  }

  private async drainRefreshes(): Promise<void> {
    do {
      this.rerun = false
      await this.reconcile().catch((error: unknown) => {
        this.args.ctx.log(`mcp: re-reading the servers failed: ${messageOf(error)}`)
      })
    } while (this.rerun)
  }

  private async publish(): Promise<void> {
    const rows = this.rows()
    const next = new Map(rows.map((row) => [row.name, row]))
    const drafts: (McpServerChanged | McpServerRemoved | McpSignInResolved)[] = []
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
    drafts.push(
      ...this.signIns.resolutionsOf({
        sessionId: this.args.ctx.sessionId,
        rows,
        now: Date.now(),
      }),
    )
    if (drafts.length === 0) return
    try {
      await this.args.ctx.append(drafts)
    } catch (error) {
      this.args.ctx.log(`mcp: recording the server roster failed: ${messageOf(error)}`)
    }
  }

  private async load() {
    return await loadMcpConfig({
      cloud: await this.args.config.read({ sessionId: this.args.ctx.sessionId }),
      directory: this.args.ctx.workspaceDirectory ?? null,
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

  private async tokenOf(spec: LoadedMcpEntry): Promise<string | undefined> {
    const transport = spec.transport
    if (transport?.kind !== 'http') return undefined
    try {
      return await this.args.ctx.control.mcp.token({
        name: spec.name,
        source: spec.source,
        url: transport.url,
      })
    } catch {
      return undefined
    }
  }

  private async markFailed(args: {
    name: string
    client: McpTransportClient
    reason: string
  }): Promise<void> {
    const held = this.held.get(args.name)
    if (held === undefined || held.client !== args.client) return
    if (held.status !== EMcpServerStatus.Connected) return
    held.status = EMcpServerStatus.Failed
    held.reason = args.reason
    await this.publish()
  }

  private async ensure(spec: LoadedMcpEntry): Promise<void> {
    const existing = this.held.get(spec.name)
    if (existing !== undefined && sameSpec(existing.spec, spec)) {
      if (existing.status === EMcpServerStatus.Connected) return
      await existing.client.close()
    } else if (existing !== undefined) {
      await existing.client.close()
    }

    const opened = await openHeld({
      spec,
      ctx: this.args.ctx,
      connectTimeoutMs: this.args.connectTimeoutMs,
      token: async (entry) => await this.tokenOf(entry),
      onClosed: (closed) => void this.markFailed(closed),
    })
    this.held.set(spec.name, opened)
  }
}
