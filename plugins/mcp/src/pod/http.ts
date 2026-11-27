import { EMcpToken, type McpToken } from '@dltech/atlas-plugin-sdk'

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

export type McpTokenSource = () => Promise<McpToken>

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
  private held: { token: string | undefined } | undefined
  private refreshing: Promise<string | undefined> | undefined

  constructor(
    private readonly args: {
      serverId: string
      transport: McpHttpTransport
      token: McpTokenSource
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
      headers: this.headers(this.held?.token),
      signal: AbortSignal.timeout(this.args.timeoutMs ?? HTTP_TIMEOUT_MS),
    }).catch(() => undefined)
    this.sessionId = undefined
  }

  private async tokenOf(): Promise<string | undefined> {
    const held = this.held
    if (held !== undefined) return held.token
    return await this.sourceToken()
  }

  private async sourceToken(): Promise<string | undefined> {
    return this.takeOf(await this.args.token())
  }

  private refreshOf(args: { stale: string | undefined }): Promise<string | undefined> {
    const running = this.refreshing
    if (running !== undefined) return running
    const held = this.held
    if (held !== undefined && held.token !== args.stale) return Promise.resolve(held.token)
    const started = this.sourceToken()
    this.refreshing = started
    return started.finally(() => {
      this.refreshing = undefined
    })
  }

  private takeOf(token: McpToken): string | undefined {
    if (token.kind === EMcpToken.Unavailable) throw this.unauthorizedOf()
    if (token.kind === EMcpToken.Refused) throw new McpTransportError(token.reason)
    const taken = { token: token.kind === EMcpToken.Granted ? token.accessToken : undefined }
    this.held = taken
    return taken.token
  }

  private unauthorizedOf(): McpUnauthorizedError {
    return new McpUnauthorizedError(
      `the '${this.args.serverId}' MCP server needs a sign-in; call operator_mcp_sign_in to start one`,
    )
  }

  private headers(token: string | undefined): Record<string, string> {
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
    const token = await this.tokenOf()
    const response = await this.send({ payload, token })
    if (response.status !== 401) return await this.readOf(response)
    const retried = await this.send({ payload, token: await this.refreshOf({ stale: token }) })
    if (retried.status === 401) throw this.unauthorizedOf()
    return await this.readOf(retried)
  }

  private async send(args: { payload: unknown; token: string | undefined }): Promise<Response> {
    return await fetch(this.args.transport.url, {
      method: 'POST',
      headers: this.headers(args.token),
      body: JSON.stringify(args.payload),
      signal: AbortSignal.timeout(this.args.timeoutMs ?? HTTP_TIMEOUT_MS),
    })
  }

  private async readOf(response: Response): Promise<unknown> {
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
