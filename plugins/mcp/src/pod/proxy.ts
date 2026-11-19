import {
  MacOfflineError,
  type PodMcpControl,
  type PodMcpProxyChannel,
  type PodMcpProxyMessage,
  type PodMcpProxyTransport,
} from '@dltech/atlas-plugin-sdk'

import { PROTOCOL_VERSION } from './stdio'
import {
  asRecord,
  callResultOf,
  McpTransportError,
  messageOf,
  type McpCallResult,
  type McpConnection,
  type McpTransportClient,
  toolsOf,
} from './types'

export const MAC_WAIT_MS = 10_000

export const REQUEST_TIMEOUT_MS = 30_000

const INITIALIZATION = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'atlas', version: '0.1.0' },
}

type Pending = { resolve(value: unknown): void; reject(reason: Error): void }

export class ProxyClient implements McpTransportClient {
  private channel: PodMcpProxyChannel | null = null
  private readonly pending = new Map<string, Pending>()
  private nextId = 1
  private closed = false

  constructor(
    private readonly args: {
      control: PodMcpControl
      serverId: string
      transport: PodMcpProxyTransport
      timeoutMs?: number
      waitMs?: number
      onClosed?: (reason: string) => void
    },
  ) {}

  async connect(): Promise<McpConnection> {
    const channel = await this.open()
    this.channel = channel
    channel.onMessage((message) => this.receive(message))
    channel.onClosed((reason) => this.receiveClosed(reason))
    const initialized = asRecord(
      await this.request({ method: 'initialize', params: INITIALIZATION }),
    )
    this.notify('notifications/initialized')
    const tools = toolsOf(await this.request({ method: 'tools/list' }))
    const instructions = initialized?.['instructions']
    return { tools, ...(typeof instructions === 'string' ? { instructions } : {}) }
  }

  async callTool(args: { name: string; input: unknown }): Promise<McpCallResult> {
    return callResultOf(
      await this.request({
        method: 'tools/call',
        params:
          args.input === null ? { name: args.name } : { name: args.name, arguments: args.input },
      }),
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.rejectAll(new McpTransportError('the Mac channel closed before a response could be read'))
    const channel = this.channel
    this.channel = null
    channel?.close()
  }

  private async open(): Promise<PodMcpProxyChannel> {
    try {
      return await this.args.control.proxy({
        name: this.args.serverId,
        transport: this.args.transport,
        waitMs: this.args.waitMs ?? MAC_WAIT_MS,
      })
    } catch (error) {
      if (error instanceof MacOfflineError) throw error
      throw new McpTransportError(
        `the Mac app could not open '${this.args.serverId}': ${messageOf(error)}`,
      )
    }
  }

  private receiveClosed(reason: string): void {
    this.rejectAll(new McpTransportError(reason))
    this.args.onClosed?.(reason)
  }

  private async request(payload: { method: string; params?: unknown }): Promise<unknown> {
    if (this.closed) throw new McpTransportError('the transport is closed')
    const id = String(this.nextId++)
    const settled = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      this.settle({ id, error: new McpTransportError(`request ${id} timed out`) })
    }, this.args.timeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      this.send({
        jsonrpc: '2.0',
        id,
        method: payload.method,
        params: payload.params,
      })
      return await settled
    } finally {
      clearTimeout(timer)
    }
  }

  private notify(method: string): void {
    this.send({ jsonrpc: '2.0', method })
  }

  private send(message: PodMcpProxyMessage): void {
    const channel = this.channel
    if (channel === null) throw new McpTransportError('the Mac channel is not open')
    channel.send(message)
  }

  private receive(message: PodMcpProxyMessage): void {
    const record = asRecord(message)
    if (record === undefined) return
    const id = record['id']
    if (id === undefined || id === null) return
    const error = record['error']
    if (error !== undefined)
      this.settle({
        id: String(id),
        error: new McpTransportError(messageOf(asRecord(error)?.['message'] ?? error)),
      })
    else this.settle({ id: String(id), value: record['result'] })
  }

  private settle(args: { id: string; value?: unknown; error?: Error }): void {
    const pending = this.pending.get(args.id)
    if (pending === undefined) return
    this.pending.delete(args.id)
    if (args.error !== undefined) pending.reject(args.error)
    else pending.resolve(args.value)
  }

  private rejectAll(error: Error): void {
    const held = [...this.pending.entries()]
    this.pending.clear()
    for (const [, pending] of held) pending.reject(error)
  }
}
