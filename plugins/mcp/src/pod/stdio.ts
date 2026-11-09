import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

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

export const STDERR_LINES = 40

const POLL_MS = 5

const STDERR_ENV = 'ATLAS_MCP_STDERR'

const INITIALIZATION = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'atlas', version: '0.1.0' },
}

type Pending = { resolve(value: unknown): void; reject(reason: Error): void }

type ReadLine = { seq: number; line: string }

type ReadResult = {
  lines: readonly ReadLine[]
  ended: { exitCode: number | null; signal: string | null } | null
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const exitReasonOf = (ended: { exitCode: number | null; signal: string | null }): string =>
  ended.signal === null
    ? `the server exited with code ${ended.exitCode ?? 'unknown'}`
    : `the server was killed by ${ended.signal}`

export class StdioClient implements McpTransportClient {
  private readonly pending = new Map<string, Pending>()
  private readonly diagnostics: string[] = []
  private afterSeq = 0
  private nextId = 1
  private pumping: Promise<void> | null = null
  private spawned = false
  private closed = false

  constructor(
    private readonly args: {
      ctx: PluginPodContext
      serverId: string
      transport: McpStdioTransport
      homeDirectory?: string | undefined
      timeoutMs?: number
    },
  ) {}

  async connect(): Promise<McpConnection> {
    await this.spawn()
    const initialized = asRecord(
      await this.request({ method: 'initialize', params: INITIALIZATION }),
    )
    await this.notify('notifications/initialized')
    const tools = toolsOf(await this.request({ method: 'tools/list' }))
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
    this.rejectAll(new McpTransportError('the transport closed before a response could be read'))
    if (!this.spawned) return
    await this.args.ctx
      .call({ op: 'mcp.close', serverId: this.args.serverId })
      .catch(() => undefined)
    await this.args.ctx.call({ op: 'remove', path: this.stderrPath() }).catch(() => undefined)
  }

  stderrTail(): Promise<readonly string[]> {
    return this.readTail()
  }

  private stderrPath(): string {
    const safe = (value: string): string => value.replace(/[^A-Za-z0-9_.-]/g, '-')
    return `/tmp/atlas-mcp-${safe(this.args.ctx.sessionId)}-${safe(this.args.serverId)}.log`
  }

  private async readTail(): Promise<readonly string[]> {
    const result = await this.args.ctx.call({ op: 'readFile', path: this.stderrPath() })
    if (result.status !== ECallStatus.Ok || result.op !== 'readFile') return []
    return result.value
      .split('\n')
      .filter((line) => line !== '')
      .slice(0, STDERR_LINES)
  }

  // `mcp.spawn` gives the child a scrubbed env and no way to forward stderr, so the entry is
  // spawned through a shell that points fd 2 at a file the daemon's file port can read. The
  // `exec` keeps the pid and the exit status the shell would otherwise add.
  private async spawn(): Promise<void> {
    const transport = this.args.transport
    const env = { ...(transport.env ?? {}), [STDERR_ENV]: this.stderrPath() }
    const result = await this.args.ctx.call({
      op: 'mcp.spawn',
      serverId: this.args.serverId,
      command: 'sh',
      args: [
        '-c',
        `exec "$0" "$@" 2>"$${STDERR_ENV}"`,
        transport.command,
        ...(transport.args ?? []),
      ],
      env,
    })
    if (result.status !== ECallStatus.Ok || result.op !== 'mcp.spawn') {
      const reason = result.status === ECallStatus.Ok ? 'spawn failed' : result.error.message
      throw new McpTransportError(`could not start the server: ${reason}`)
    }
    this.spawned = true
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
    const pumping = this.pump()
    try {
      await this.send({ jsonrpc: '2.0', id, method: payload.method, params: payload.params })
      return await settled
    } finally {
      clearTimeout(timer)
      void pumping
    }
  }

  private async notify(method: string): Promise<void> {
    await this.send({ jsonrpc: '2.0', method })
  }

  private async send(message: unknown): Promise<void> {
    const line = JSON.stringify(message)
    const result = await this.args.ctx.call({
      op: 'mcp.send',
      serverId: this.args.serverId,
      line,
    })
    if (result.status === ECallStatus.Ok) return
    throw new McpTransportError(`could not write to the server: ${result.error.message}`)
  }

  private pump(): Promise<void> {
    if (this.pumping !== null) return this.pumping
    this.pumping = this.drain().finally(() => {
      this.pumping = null
    })
    return this.pumping
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0 && !this.closed) {
      const read = await this.read()
      if (read === null) return
      for (const entry of read.lines) {
        this.afterSeq = entry.seq
        this.receive(entry.line)
      }
      if (read.ended !== null) {
        const tail = await this.readTail()
        this.rejectAll(new McpTransportError(exitReasonOf(read.ended), tail))
        return
      }
      if (this.pending.size > 0) await delay(POLL_MS)
    }
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
    } catch (error) {
      this.note(line, messageOf(error))
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

  private note(line: string, detail: string): void {
    if (this.diagnostics.length >= STDERR_LINES) return
    this.diagnostics.push(detail === line ? line : `${line} (${detail})`)
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
