import { MacOfflineError, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { LoadedMcpEntry } from '../core'
import { HttpClient } from './http'
import { ProxyClient } from './proxy'
import { EMcpServerStatus, reasonOf } from './server-status'
import { StdioClient } from './stdio'
import {
  McpTransportError,
  McpUnauthorizedError,
  type McpToolInfo,
  type McpTransportClient,
} from './types'

export type Held = {
  spec: LoadedMcpEntry
  client: McpTransportClient
  status: EMcpServerStatus
  tools: readonly McpToolInfo[]
  reason: string | undefined
  instructions: string | undefined
}

export type HeldClosed = {
  name: string
  client: McpTransportClient
  reason: string
}

export const sameSpec = (left: LoadedMcpEntry, right: LoadedMcpEntry): boolean =>
  JSON.stringify([left.transport, left.disabled, left.proxy]) ===
  JSON.stringify([right.transport, right.disabled, right.proxy])

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

export const withBudget = async (args: {
  ms: number
  run: () => Promise<unknown>
}): Promise<void> => {
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

const failedHeld = (args: {
  spec: LoadedMcpEntry
  client: McpTransportClient
  reason: string
}): Held => ({
  spec: args.spec,
  client: args.client,
  status: EMcpServerStatus.Failed,
  tools: [],
  reason: args.reason,
  instructions: undefined,
})

const statusOfFailure = (error: unknown): EMcpServerStatus => {
  if (error instanceof MacOfflineError) return EMcpServerStatus.Unavailable
  if (error instanceof McpUnauthorizedError) return EMcpServerStatus.NeedsAuth
  return EMcpServerStatus.Failed
}

export const openHeld = async (args: {
  spec: LoadedMcpEntry
  ctx: PluginPodContext
  connectTimeoutMs: number
  token: (spec: LoadedMcpEntry) => Promise<string | undefined>
  onClosed: (closed: HeldClosed) => void
}): Promise<Held> => {
  const { spec } = args
  const transport = spec.transport
  if (transport === undefined) {
    return failedHeld({
      spec,
      client: new HttpClient({
        serverId: spec.name,
        transport: { kind: 'http', url: 'http://localhost' },
      }),
      reason: 'the server has no transport',
    })
  }

  const closed = (reason: string): void => args.onClosed({ name: spec.name, client, reason })
  const token = spec.proxy === true ? undefined : (spec.accessToken ?? (await args.token(spec)))
  const client: McpTransportClient =
    spec.proxy === true
      ? new ProxyClient({
          control: args.ctx.control.mcp,
          serverId: spec.name,
          transport,
          onClosed: closed,
        })
      : transport.kind === 'http'
        ? new HttpClient({
            serverId: spec.name,
            transport,
            ...(token === undefined ? {} : { accessToken: token }),
          })
        : new StdioClient({
            ctx: args.ctx,
            serverId: spec.name,
            transport,
            onExit: closed,
          })

  try {
    const connection = await withCeiling({
      ms: args.connectTimeoutMs,
      message: `the '${spec.name}' MCP server did not answer initialize within ${args.connectTimeoutMs} ms`,
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
      status: statusOfFailure(error),
      tools: [],
      reason: reasonOf(error),
      instructions: undefined,
    }
  }
}
