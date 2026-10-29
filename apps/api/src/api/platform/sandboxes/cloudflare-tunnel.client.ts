import { BadGatewayException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const REQUEST_TIMEOUT_MS = 30_000
const CATCH_ALL_SERVICE = 'http_status:404'

export interface CloudflareHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export interface CloudflareHttpResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type CloudflareFetchFn = (
  url: string,
  request: CloudflareHttpRequest,
) => Promise<CloudflareHttpResponse>

export class CloudflareRecordExistsError extends BadGatewayException {}

export type DnsRecord = { id: string; content: string }

export type IngressRule = { hostname: string; port: number }

const defaultCloudflareFetch: CloudflareFetchFn = (url, request) => fetch(url, request)

function parseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  } catch {
    return {}
  }
}

const RECORD_EXISTS_CODES = [81053, 81057]

function isRecordExists(body: Record<string, unknown>): boolean {
  const errors = body.errors
  if (!Array.isArray(errors)) return false
  return errors.some((error: unknown) => {
    if (typeof error !== 'object' || error === null) return false
    const code = 'code' in error ? error.code : undefined
    const message = 'message' in error ? error.message : undefined
    return (
      (typeof code === 'number' && RECORD_EXISTS_CODES.includes(code)) ||
      (typeof message === 'string' && message.toLowerCase().includes('already exist'))
    )
  })
}

function errorMessages(body: Record<string, unknown>): string[] {
  const errors = body.errors
  if (!Array.isArray(errors)) return []
  return errors.flatMap((error: unknown) => {
    if (typeof error !== 'object' || error === null || !('message' in error)) return []
    return typeof error.message === 'string' ? [error.message] : []
  })
}

function resultOf(body: Record<string, unknown>): Record<string, unknown> {
  const { result } = body
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? Object.fromEntries(Object.entries(result))
    : {}
}

function requireString(args: { result: Record<string, unknown>; key: string; operation: string }) {
  const value = args.result[args.key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadGatewayException(
      `cloudflare ${args.operation} returned an unexpected response (missing ${args.key})`,
    )
  }
  return value
}

export class CloudflareTunnelClient {
  private readonly fetchFn: CloudflareFetchFn

  constructor(
    private readonly env: EnvService,
    args: { fetchFn?: CloudflareFetchFn } = {},
  ) {
    this.fetchFn = args.fetchFn ?? defaultCloudflareFetch
  }

  async createTunnel(args: { name: string }): Promise<{ id: string; token: string }> {
    const operation = 'create tunnel'
    const result = await this.send({
      operation,
      method: 'POST',
      path: `/accounts/${this.env.get('CLOUDFLARE_ACCOUNT_ID')}/cfd_tunnel`,
      payload: { name: args.name, config_src: 'cloudflare' },
    })
    return {
      id: requireString({ result, key: 'id', operation }),
      token: requireString({ result, key: 'token', operation }),
    }
  }

  async putIngress(args: { tunnelId: string; rules: IngressRule[] }): Promise<void> {
    const ingress = [
      ...args.rules.map((rule) => ({
        hostname: rule.hostname,
        service: `http://localhost:${rule.port}`,
        originRequest: {},
      })),
      { service: CATCH_ALL_SERVICE },
    ]
    await this.send({
      operation: 'update tunnel ingress',
      method: 'PUT',
      path: `/accounts/${this.env.get('CLOUDFLARE_ACCOUNT_ID')}/cfd_tunnel/${args.tunnelId}/configurations`,
      payload: { config: { ingress } },
    })
  }

  async createCname(args: { hostname: string; tunnelId: string }): Promise<{ id: string }> {
    const operation = 'create dns record'
    const result = await this.send({
      operation,
      method: 'POST',
      path: `/zones/${this.env.get('CLOUDFLARE_ZONE_ID')}/dns_records`,
      payload: {
        type: 'CNAME',
        proxied: true,
        name: args.hostname,
        content: `${args.tunnelId}.cfargotunnel.com`,
      },
    })
    return { id: requireString({ result, key: 'id', operation }) }
  }

  async findDnsRecord(args: { hostname: string }): Promise<DnsRecord | undefined> {
    const body = await this.request({
      operation: 'find dns record',
      method: 'GET',
      path: `/zones/${this.env.get('CLOUDFLARE_ZONE_ID')}/dns_records?name=${encodeURIComponent(args.hostname)}`,
    })
    const records = Array.isArray(body.result) ? body.result : []
    for (const record of records) {
      if (typeof record !== 'object' || record === null) continue
      const { id, content } = Object.fromEntries(Object.entries(record))
      if (typeof id === 'string' && typeof content === 'string') return { id, content }
    }
    return undefined
  }

  async repointCname(args: { recordId: string; hostname: string; tunnelId: string }) {
    await this.send({
      operation: 'update dns record',
      method: 'PUT',
      path: `/zones/${this.env.get('CLOUDFLARE_ZONE_ID')}/dns_records/${args.recordId}`,
      payload: {
        type: 'CNAME',
        proxied: true,
        name: args.hostname,
        content: `${args.tunnelId}.cfargotunnel.com`,
      },
    })
  }

  async deleteDnsRecord(args: { recordId: string }): Promise<void> {
    await this.send({
      operation: 'delete dns record',
      method: 'DELETE',
      path: `/zones/${this.env.get('CLOUDFLARE_ZONE_ID')}/dns_records/${args.recordId}`,
      tolerateMissing: true,
    })
  }

  async deleteTunnel(args: { tunnelId: string }): Promise<void> {
    const tunnelPath = `/accounts/${this.env.get('CLOUDFLARE_ACCOUNT_ID')}/cfd_tunnel/${args.tunnelId}`
    await this.send({
      operation: 'clean up tunnel connections',
      method: 'DELETE',
      path: `${tunnelPath}/connections`,
      tolerateMissing: true,
    })
    await this.send({
      operation: 'delete tunnel',
      method: 'DELETE',
      path: tunnelPath,
      tolerateMissing: true,
    })
  }

  private async send(args: Parameters<CloudflareTunnelClient['request']>[0]) {
    return resultOf(await this.request(args))
  }

  private async request(args: {
    operation: string
    method: CloudflareHttpRequest['method']
    path: string
    payload?: unknown
    tolerateMissing?: boolean
  }): Promise<Record<string, unknown>> {
    const response = await this.fetchFn(`${API_BASE}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${this.env.get('CLOUDFLARE_API_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      ...(args.payload === undefined ? {} : { body: JSON.stringify(args.payload) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (args.tolerateMissing === true && response.status === 404) return {}
    const body = parseJson(await response.text())
    if (response.ok && body.success !== false) return body
    if (isRecordExists(body)) {
      throw new CloudflareRecordExistsError(
        `cloudflare ${args.operation} failed: record already exists`,
      )
    }
    const messages = errorMessages(body)
    throw new BadGatewayException(
      messages.length > 0
        ? `cloudflare ${args.operation} failed: ${messages.join('; ')}`
        : `cloudflare ${args.operation} failed with status ${response.status}`,
    )
  }
}
