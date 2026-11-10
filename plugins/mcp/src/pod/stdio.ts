import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { type DaemonEvent, ECallStatus } from '@dltech/atlas-protocol'

import type { McpStdioTransport } from '../core'
import {
  asRecord,
  callResultOf,
  McpTransportError,
  messageOf,
  type McpCallResult,
  type McpConnection,
  type McpToolInfo,
  type McpTransportClient,
  toolsOf,
} from './types'

export const PROTOCOL_VERSION = '2025-06-18'

export const REQUEST_TIMEOUT_MS = 30_000

const INITIALIZATION = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'atlas', version: '0.1.0' },
}

type Pending = { resolve(value: unknown): void; reject(reason: Error): void }

type Exit = { exitCode: number | null; signal: string | null }

type ReadLine = { seq: number; line: string }

type ReadResult = { lines: readonly ReadLine[]; stderr: readonly string[]; ended: Exit | null }

const exitReasonOf = (ended: Exit): string =>
  ended.signal === null
    ? `the server exited with code ${ended.exitCode ?? 'unknown'}`
    : `the server was killed by ${ended.signal}`

export class StdioClient implements McpTransportClient {
  private readonly pending = new Map<string, Pending>()
  private afterSeq = 0
  private nextId = 1
  private spawned = false
  private closed = false
  private exitError: McpTransportError | null = null
  private off: (() => void) | null = null
  private catching: Promise<void> | null = null

  constructor(
    private readonly args: {
      ctx: PluginPodContext
      serverId: string
      transport: McpStdioTransport
      timeoutMs?: number
      onExit?: (reason: string) => void
    },
  ) {}

  async connect(): Promise<McpConnection> {
    this.subscribe()
    await this.spawn()
    const initialized = asRecord(
      await this.request({ method: 'initialize', params: INITIALIZATION }),
    )
    await this.notify('notifications/initialized')
    const tools = await this.listTools()
    const instructions = initialized?.['instructions']
    return { tools, ...(typeof instructions === 'string' ? { instructions } : {}) }
  }

  async listTools(): Promise<readonly McpToolInfo[]> {
    return toolsOf(await this.request({ method: 'tools/list' }))
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
    this.off?.()
    this.off = null
    this.rejectAll(new McpTransportError('the transport closed before a response could be read'))
    if (!this.spawned) return
    await this.args.ctx
      .call({ op: 'mcp.close', serverId: this.args.serverId })
      .catch(() => undefined)
  }

  private subscribe(): void {
    if (this.off !== null) return
    this.off = this.args.ctx.onDaemonEvent((frame) => {
      if (frame.kind === 'event') this.handleEvent(frame.event)
    })
  }

  private handleEvent(frame: DaemonEvent): void {
    if (frame.type === 'mcp.message') {
      if (frame.serverId !== this.args.serverId) return
      if (frame.seq === this.afterSeq + 1) {
        this.afterSeq = frame.seq
        this.receive(frame.line)
        return
      }
      if (frame.seq > this.afterSeq + 1) void this.catchUp()
      return
    }
    if (frame.type === 'mcp.dropped') {
      if (frame.serverId !== this.args.serverId) return
      void this.catchUp()
      return
    }
    if (frame.type === 'mcp.exited') {
      if (frame.serverId !== this.args.serverId) return
      void this.finish({ exitCode: frame.exitCode, signal: frame.signal })
    }
  }

  private async spawn(): Promise<void> {
    const transport = this.args.transport
    const result = await this.args.ctx.call({
      op: 'mcp.spawn',
      serverId: this.args.serverId,
      command: transport.command,
      ...(transport.args === undefined ? {} : { args: transport.args }),
      ...(transport.env === undefined ? {} : { env: transport.env }),
    })
    if (result.status !== ECallStatus.Ok || result.op !== 'mcp.spawn') {
      const reason = result.status === ECallStatus.Ok ? 'spawn failed' : result.error.message
      throw new McpTransportError(`could not start the server: ${reason}`)
    }
    this.spawned = true
  }

  private async request(payload: { method: string; params?: unknown }): Promise<unknown> {
    if (this.closed) throw new McpTransportError('the transport is closed')
    if (this.exitError !== null) throw this.exitError
    const id = String(this.nextId++)
    const settled = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    const timer = setTimeout(() => {
      this.settle({ id, error: new McpTransportError(`request ${id} timed out`) })
    }, this.args.timeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      await this.send({ jsonrpc: '2.0', id, method: payload.method, params: payload.params })
      return await settled
    } finally {
      clearTimeout(timer)
    }
  }

  private async notify(method: string): Promise<void> {
    await this.send({ jsonrpc: '2.0', method })
  }

  private async send(message: unknown): Promise<void> {
    const result = await this.args.ctx.call({
      op: 'mcp.send',
      serverId: this.args.serverId,
      line: JSON.stringify(message),
    })
    if (result.status === ECallStatus.Ok) return
    throw new McpTransportError(`could not write to the server: ${result.error.message}`)
  }

  private catchUp(): Promise<void> {
    if (this.catching !== null) return this.catching
    this.catching = this.readMissed().finally(() => {
      this.catching = null
    })
    return this.catching
  }

  private async readMissed(): Promise<void> {
    const read = await this.read()
    if (read === null) return
    for (const entry of read.lines) {
      if (entry.seq <= this.afterSeq) continue
      this.afterSeq = entry.seq
      this.receive(entry.line)
    }
    if (read.ended !== null) await this.finish(read.ended)
  }

  private async finish(exit: Exit): Promise<void> {
    if (this.exitError !== null) return
    const read = await this.read()
    if (read !== null) {
      for (const entry of read.lines) {
        if (entry.seq <= this.afterSeq) continue
        this.afterSeq = entry.seq
        this.receive(entry.line)
      }
    }
    this.exitError = new McpTransportError(exitReasonOf(exit), read?.stderr ?? [])
    this.rejectAll(this.exitError)
    if (this.closed) return
    this.args.onExit?.(this.exitError.message)
  }

  private async read(): Promise<ReadResult | null> {
    const result = await this.args.ctx.call({
      op: 'mcp.read',
      serverId: this.args.serverId,
      afterSeq: this.afterSeq,
    })
    if (result.status !== ECallStatus.Ok || result.op !== 'mcp.read') return null
    return result.value
  }

  private receive(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
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
