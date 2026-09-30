import { DynamicToolSource, type ToolDeclaration, type ToolDefinition } from '@dltech/atlas-core'

import type { LoadedMcpSpec } from '../config'
import type { McpOAuthFlow } from '../oauth/flow'
import {
  EMcpServerStatus,
  type McpHandle,
  type McpHandleState,
  type McpServerStatus,
} from '../registry/handle-status'
import {
  HttpTransport,
  McpUnauthorizedError,
  StdioTransport,
  type McpAuthProvider,
  type McpToolInfo,
  type ServerTransport,
} from '../transport'
import { McpBridgeTool } from './bridge-tool'

export const CONNECT_TIMEOUT_MS = 30_000

export type McpTransportFactory = (spec: LoadedMcpSpec) => ServerTransport

const transportOf = (spec: LoadedMcpSpec): ServerTransport => {
  if (spec.transport?.kind === 'http') return new HttpTransport(spec.transport)
  if (spec.transport?.kind === 'stdio') return new StdioTransport(spec.transport)
  return new NeverConnects()
}

/**
 * Per-server OAuth plumbing: feeds the transport a bearer token and remembers the WWW-Authenticate
 * challenge from the last 401 so a later sign-in can resume with the server's requested scope.
 */
class ServerAuth implements McpAuthProvider {
  private challenge: string | undefined

  constructor(private readonly args: { serverUrl: string; flow: McpOAuthFlow }) {}

  async bearerToken(): Promise<string | undefined> {
    return this.args.flow.currentToken({ serverUrl: this.args.serverUrl })
  }

  onUnauthorized(args: { wwwAuthenticate: string | undefined }): void {
    this.challenge = args.wwwAuthenticate
  }

  lastChallenge(): string | undefined {
    return this.challenge
  }
}

class NeverConnects implements ServerTransport {
  connect(): Promise<never> {
    return Promise.reject(new Error('no transport is declared on this server'))
  }

  listTools(): Promise<McpToolInfo[]> {
    return Promise.resolve([])
  }

  callTool(): Promise<never> {
    return Promise.reject(new Error('the server never connected'))
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

const failedStateOf = (error: unknown): McpHandleState => ({
  status: EMcpServerStatus.Failed,
  error: error instanceof Error ? error.message : String(error),
})

export type ConnectedHandle = {
  handle: McpHandle
  tools: readonly McpToolInfo[]
}

export class HandleStore extends DynamicToolSource {
  private readonly handles = new Map<string, ConnectedHandle>()
  private readonly auths = new Map<string, ServerAuth>()
  private readonly specs: readonly LoadedMcpSpec[]
  private readonly connectTimeoutMs: number
  private readonly factory: McpTransportFactory
  private readonly authFlow: McpOAuthFlow | undefined

  constructor(args: {
    specs: readonly LoadedMcpSpec[]
    transportFactory?: McpTransportFactory
    connectTimeoutMs?: number
    authFlow?: McpOAuthFlow
  }) {
    super()
    this.specs = args.specs
    this.factory = args.transportFactory ?? ((spec) => transportOf(spec))
    this.connectTimeoutMs = args.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.authFlow = args.authFlow
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
    await Promise.allSettled(
      this.specs.map(async (spec) => {
        const opened = await this.open(spec)
        this.handles.set(spec.name, opened)
      }),
    )
  }

  /** Re-opens a server, closing its prior transport — used after a sign-in stores a fresh token. */
  async reconnect(args: { serverId: string }): Promise<void> {
    const spec = this.specs.find((candidate) => candidate.name === args.serverId)
    if (spec === undefined) return
    const prior = this.handles.get(args.serverId)
    if (prior !== undefined) await prior.handle.transport.close().catch(() => undefined)
    this.auths.delete(args.serverId)
    this.handles.set(args.serverId, await this.open(spec))
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
    })
  }

  private transportOf(args: { serverId: string }): ServerTransport | undefined {
    if (this.closed) return undefined
    const handle = this.handles.get(args.serverId)?.handle
    if (handle?.state.status !== EMcpServerStatus.Connected) return undefined
    return handle?.transport
  }

  private closed = false

  async closeAll(): Promise<void> {
    const handles = [...this.handles.values()]
    this.closed = true
    this.handles.clear()
    for (const { handle } of handles) {
      await handle.transport.close().catch(() => undefined)
    }
  }

  private async open(spec: LoadedMcpSpec): Promise<ConnectedHandle> {
    const transport = this.transportFor(spec)

    if (spec.disabled === true) {
      return {
        handle: {
          spec,
          transport,
          capabilities: undefined,
          state: { status: EMcpServerStatus.Disabled },
        },
        tools: [],
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
      }
    }
  }

  private transportFor(spec: LoadedMcpSpec): ServerTransport {
    if (spec.transport?.kind !== 'http' || this.authFlow === undefined) return this.factory(spec)
    const auth = new ServerAuth({ serverUrl: spec.transport.url, flow: this.authFlow })
    this.auths.set(spec.name, auth)
    return new HttpTransport(spec.transport, auth)
  }

  /** The WWW-Authenticate challenge a server last answered 401 with, to seed a sign-in's scope. */
  challengeOf(args: { serverId: string }): string | undefined {
    return this.auths.get(args.serverId)?.lastChallenge()
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
