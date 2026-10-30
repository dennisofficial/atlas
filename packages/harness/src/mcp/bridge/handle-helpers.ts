import type { LoadedMcpSpec } from '../config'
import { EMcpServerStatus, type McpHandleState } from '../registry/handle-status'
import { HttpTransport, StdioTransport, type McpToolInfo, type ServerTransport } from '../transport'

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

export const transportOf = (spec: LoadedMcpSpec): ServerTransport => {
  if (spec.transport?.kind === 'http') return new HttpTransport(spec.transport)
  if (spec.transport?.kind === 'stdio') return new StdioTransport(spec.transport)
  return new NeverConnects()
}

export const specChanged = (args: { prior: LoadedMcpSpec; next: LoadedMcpSpec }): boolean =>
  JSON.stringify([args.prior.transport, args.prior.disabled]) !==
  JSON.stringify([args.next.transport, args.next.disabled])

export const failedStateOf = (error: unknown): McpHandleState => ({
  status: EMcpServerStatus.Failed,
  error: error instanceof Error ? error.message : String(error),
})

export const hasAuthorizationHeader = (headers: Record<string, string> | undefined): boolean =>
  Object.keys(headers ?? {}).some((name) => name.toLowerCase() === 'authorization')

export const closeQuietly = (transport: ServerTransport): Promise<void> =>
  transport.close().catch(() => undefined)
