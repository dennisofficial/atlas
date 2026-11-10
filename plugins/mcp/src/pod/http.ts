import type { McpHttpTransport } from '../core'
import {
  asRecord,
  callResultOf,
  McpTransportError,
  McpUnauthorizedError,
  messageOf,
  type McpCallResult,
  type McpConnection,
  type McpTransportClient,
  toolsOf,
} from './types'

export const HTTP_TIMEOUT_MS = 30_000

const INITIALIZATION = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'atlas', version: '0.1.0' },
}

const eventDataOf = (text: string): unknown => {
  let last: unknown
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice('data:'.length).trim()
    if (data === '') continue
    try {
      last = JSON.parse(data)
    } catch (error) {
      throw new McpTransportError(`the server sent an unreadable event: ${messageOf(error)}`)
    }
  }
  return last
}

export class HttpClient implements McpTransportClient {
  private sessionId: string | undefined
  private nextId = 1

  constructor(
    private readonly args: {
      serverId: string
      transport: McpHttpTransport
      accessToken?: string | undefined
      timeoutMs?: number
    },
  ) {}

  async connect(): Promise<McpConnection> {
    const initialized = asRecord(
      await this.request({ method: 'initialize', params: INITIALIZATION }),
    )
    await this.notify({ method: 'notifications/initialized' })
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
    if (this.sessionId === undefined) return
    await fetch(this.args.transport.url, {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.args.timeoutMs ?? HTTP_TIMEOUT_MS),
    }).catch(() => undefined)
    this.sessionId = undefined
  }

  private headers(): Record<string, string> {
    const token = this.args.accessToken
    return {
      ...(this.args.transport.headers ?? {}),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId === undefined ? {} : { 'mcp-session-id': this.sessionId }),
    }
  }

  private async request(payload: { method: string; params?: unknown }): Promise<unknown> {
    const id = String(this.nextId++)
    const response = await this.post({
      jsonrpc: '2.0',
      id,
      method: payload.method,
      params: payload.params,
    })
    const record = asRecord(response)
    const error = record?.['error']
    if (error !== undefined)
      throw new McpTransportError(messageOf(asRecord(error)?.['message'] ?? error))
    return record?.['result']
  }

  private async notify(payload: { method: string }): Promise<void> {
    await this.post({ jsonrpc: '2.0', ...payload })
  }

  private async post(payload: unknown): Promise<unknown> {
    const response = await fetch(this.args.transport.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.args.timeoutMs ?? HTTP_TIMEOUT_MS),
    })
    if (response.status === 401)
      throw new McpUnauthorizedError(`the '${this.args.serverId}' MCP server needs a sign-in`)
    if (!response.ok)
      throw new McpTransportError(
        `the '${this.args.serverId}' MCP server answered ${response.status}`,
      )
    const session = response.headers.get('mcp-session-id')
    if (session !== null) this.sessionId = session
    const text = await response.text()
    if (text.trim() === '') return undefined
    const type = response.headers.get('content-type') ?? ''
    if (type.includes('text/event-stream')) return eventDataOf(text)
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new McpTransportError(`the server sent unreadable JSON: ${messageOf(error)}`)
    }
  }
}
