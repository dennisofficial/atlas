import { DynamicToolSource, type ToolDeclaration, type ToolDefinition } from '@dltech/atlas-core'

import type { LoadedMcpSpec } from '../config'
import { EMcpServerStatus, type McpHandle, type McpServerStatus } from '../registry/handle-status'
import {
  HttpTransport,
  McpUnauthorizedError,
  type McpToolInfo,
  type ServerTransport,
} from '../transport'
import { McpBridgeTool } from './bridge-tool'
import {
  closeQuietly,
  failedStateOf,
  hasAuthorizationHeader,
  specChanged,
  transportOf as defaultTransportOf,
} from './handle-helpers'
import { ServerAuth } from './server-auth'
import type { McpTokenSource } from './token-source'

export const CONNECT_TIMEOUT_MS = 30_000

export type McpTransportFactory = (spec: LoadedMcpSpec) => ServerTransport

const isRetryable = (handle: McpHandle): boolean =>
  handle.state.status === EMcpServerStatus.NeedsAuth ||
  (handle.state.status === EMcpServerStatus.Failed && handle.spec.transport?.kind === 'http')

export type ConnectedHandle = {
  handle: McpHandle
  tools: readonly McpToolInfo[]
  auth?: ServerAuth | undefined
}

export class HandleStore extends DynamicToolSource {
  private readonly handles = new Map<string, ConnectedHandle>()
  private readonly generations = new Map<string, number>()
  private readonly recoveries = new Map<string, Promise<void>>()
  private closed = false
  private specs: readonly LoadedMcpSpec[]
  private readonly connectTimeoutMs: number
  private readonly factory: McpTransportFactory
  private readonly tokenSource: McpTokenSource | undefined

  constructor(args: {
    specs: readonly LoadedMcpSpec[]
    transportFactory?: McpTransportFactory
    connectTimeoutMs?: number
    tokenSource?: McpTokenSource
  }) {
    super()
    this.specs = args.specs
    this.factory = args.transportFactory ?? ((spec) => defaultTransportOf(spec))
    this.connectTimeoutMs = args.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.tokenSource = args.tokenSource
  }

  statusOf(args: { serverId: string }): McpHandle | undefined {
    if (this.closed) return undefined
    return this.handles.get(args.serverId)?.handle
  }

  allHandles(): readonly McpHandle[] {
    if (this.closed) return []
    return [...this.handles.values()].map(({ handle }) => handle)
  }

  servers(): readonly McpServerStatus[] {
    if (this.closed) return []
    return [...this.handles.values()].map(({ handle, tools }) => ({
      spec: handle.spec,
      state: handle.state,
      tools: tools.length,
    }))
  }

  async connectAll(): Promise<void> {
    await Promise.allSettled(this.specs.map((spec) => this.reopen(spec)))
  }

  /** Re-opens a server, closing its prior transport — used after a sign-in stores a fresh token. */
  async reconnect(args: { serverId: string }): Promise<void> {
    const spec = this.specs.find((candidate) => candidate.name === args.serverId)
    if (spec === undefined) return
    await this.reopen(spec)
  }

  async reconcile(args: { specs: readonly LoadedMcpSpec[] }): Promise<void> {
    if (this.closed) return
    this.specs = args.specs
    const wanted = new Set(args.specs.map((spec) => spec.name))
    for (const name of [...this.handles.keys()].filter((candidate) => !wanted.has(candidate))) {
      await this.drop({ serverId: name })
    }

    await Promise.allSettled(
      args.specs.map(async (spec) => {
        const prior = this.handles.get(spec.name)
        if (prior !== undefined && !specChanged({ prior: prior.handle.spec, next: spec })) return
        await this.reopen(spec)
      }),
    )
  }

  async retryNeedsAuth(): Promise<void> {
    const source = this.tokenSource
    if (source === undefined || this.closed) return
    source.clearFailures?.()
    const waiting = [...this.handles.values()].filter(({ handle }) => isRetryable(handle))
    await Promise.allSettled(
      waiting.map(async ({ handle }) => {
        const transport = handle.spec.transport
        if (transport?.kind !== 'http' || hasAuthorizationHeader(transport.headers)) return
        const token = await source.currentToken({ serverUrl: transport.url })
        if (token === undefined) return
        await this.reconnect({ serverId: handle.spec.name })
      }),
    )
  }

  private async reopen(spec: LoadedMcpSpec): Promise<void> {
    if (this.closed) return
    const generation = (this.generations.get(spec.name) ?? 0) + 1
    this.generations.set(spec.name, generation)
    const prior = this.handles.get(spec.name)
    if (prior !== undefined) await closeQuietly(prior.handle.transport)
    const opened = await this.open(spec)
    if (this.closed || this.generations.get(spec.name) !== generation) {
      await closeQuietly(opened.handle.transport)
      return
    }
    this.handles.set(spec.name, opened)
  }

  private async drop(args: { serverId: string }): Promise<void> {
    const prior = this.handles.get(args.serverId)
    this.handles.delete(args.serverId)
    this.generations.set(args.serverId, (this.generations.get(args.serverId) ?? 0) + 1)
    if (prior !== undefined) await closeQuietly(prior.handle.transport)
  }

  private recover(args: { serverId: string; transport: ServerTransport }): void {
    const current = this.handles.get(args.serverId)
    if (this.closed || current?.handle.transport !== args.transport) return
    if (this.recoveries.has(args.serverId)) return
    const run = this.reconnect({ serverId: args.serverId })
      .catch(() => undefined)
      .then(() => this.requireConnected(args.serverId))
      .finally(() => this.recoveries.delete(args.serverId))
    this.recoveries.set(args.serverId, run)
  }

  private requireConnected(serverId: string): void {
    const current = this.handles.get(serverId)
    if (current === undefined || this.closed) return
    if (current.handle.state.status === EMcpServerStatus.Connected) return
    this.handles.set(serverId, {
      ...current,
      handle: { ...current.handle, state: { status: EMcpServerStatus.NeedsAuth } },
      tools: [],
    })
  }

  declarations(): readonly ToolDeclaration[] {
    return [...this.handles.values()]
      .filter(({ handle }) => handle.state.status === EMcpServerStatus.Connected)
      .flatMap(({ handle, tools }) => tools.map((info) => this.bridge(handle, info)))
  }

  find(name: string): ToolDefinition | undefined {
    for (const { handle, tools } of this.handles.values()) {
      for (const info of tools) {
        const bridged = this.bridge(handle, info)
        if (bridged.name === name) return bridged
      }
    }
    return undefined
  }

  private bridge(handle: McpHandle, info: McpToolInfo): McpBridgeTool {
    return new McpBridgeTool({
      serverId: handle.spec.name,
      info,
      transportOf: (serverId) => this.transportOf({ serverId }),
      onUnauthorized: (args) => this.recover(args),
    })
  }

  private transportOf(args: { serverId: string }): ServerTransport | undefined {
    if (this.closed) return undefined
    const handle = this.handles.get(args.serverId)?.handle
    if (handle?.state.status !== EMcpServerStatus.Connected) return undefined
    return handle?.transport
  }

  async closeAll(): Promise<void> {
    const handles = [...this.handles.values()]
    this.closed = true
    this.handles.clear()
    for (const { handle } of handles) await closeQuietly(handle.transport)
  }

  private async open(spec: LoadedMcpSpec): Promise<ConnectedHandle> {
    const { transport, auth } = this.transportFor(spec)

    if (spec.disabled === true) {
      return {
        handle: {
          spec,
          transport,
          capabilities: undefined,
          state: { status: EMcpServerStatus.Disabled },
        },
        tools: [],
        auth,
      }
    }

    try {
      const capabilities = await this.withTimeout(transport.connect())
      const tools = capabilities.tools ? await this.withTimeout(transport.listTools()) : []
      return {
        handle: {
          spec,
          transport,
          capabilities,
          state: { status: EMcpServerStatus.Connected },
        },
        tools,
        auth,
      }
    } catch (error) {
      return {
        handle: {
          spec,
          transport,
          capabilities: undefined,
          state:
            error instanceof McpUnauthorizedError
              ? { status: EMcpServerStatus.NeedsAuth }
              : failedStateOf(error),
        },
        tools: [],
        auth,
      }
    }
  }

  private transportFor(spec: LoadedMcpSpec): {
    transport: ServerTransport
    auth: ServerAuth | undefined
  } {
    const http = spec.transport?.kind === 'http' ? spec.transport : undefined
    if (
      http === undefined ||
      this.tokenSource === undefined ||
      hasAuthorizationHeader(http.headers)
    ) {
      return { transport: this.factory(spec), auth: undefined }
    }
    const auth = new ServerAuth({ serverUrl: http.url, source: this.tokenSource })
    return { transport: new HttpTransport(http, auth), auth }
  }

  /** The WWW-Authenticate challenge a server last answered 401 with, to seed a sign-in's scope. */
  challengeOf(args: { serverId: string }): string | undefined {
    return this.handles.get(args.serverId)?.auth?.lastChallenge()
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`the server did not answer within ${this.connectTimeoutMs} ms`)),
        this.connectTimeoutMs,
      )
      timer.unref?.()
    })
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
  }
}
