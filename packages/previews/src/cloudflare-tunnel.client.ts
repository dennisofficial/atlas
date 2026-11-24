import {
  CloudflareRequest,
  type CloudflareConfig,
  type CloudflareFetchFn,
  type CloudflareHttpRequest,
  type CloudflareHttpResponse,
  requireString,
  resultsOf,
  stringOf,
  totalPagesOf,
} from './cloudflare-request'
import { PreviewUpstreamError } from './errors'

const CATCH_ALL_SERVICE = 'http_status:404'
const DNS_PAGE_SIZE = 100

export type { CloudflareConfig, CloudflareFetchFn, CloudflareHttpRequest, CloudflareHttpResponse }

export type DnsRecord = { id: string; content: string }

export type DnsRecordSummary = { id: string; name: string; content: string; createdAt?: string }

export type TunnelSummary = { id: string; name: string; createdAt?: string }

export type IngressRule = { hostname: string; port: number }

export class CloudflareTunnelClient {
  private readonly http: CloudflareRequest
  private readonly config: CloudflareConfig

  constructor(config: CloudflareConfig, args: { fetchFn?: CloudflareFetchFn } = {}) {
    this.config = config
    this.http = new CloudflareRequest(config, args)
  }

  async createTunnel(args: { name: string }): Promise<{ id: string; token: string }> {
    const operation = 'create tunnel'
    const result = await this.http.send({
      operation,
      method: 'POST',
      path: `/accounts/${this.config.accountId}/cfd_tunnel`,
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
    await this.http.send({
      operation: 'update tunnel ingress',
      method: 'PUT',
      path: `/accounts/${this.config.accountId}/cfd_tunnel/${args.tunnelId}/configurations`,
      payload: { config: { ingress } },
    })
  }

  async createCname(args: { hostname: string; tunnelId: string }): Promise<{ id: string }> {
    const operation = 'create dns record'
    const result = await this.http.send({
      operation,
      method: 'POST',
      path: `/zones/${this.config.zoneId}/dns_records`,
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
    const body = await this.http.request({
      operation: 'find dns record',
      method: 'GET',
      path: `/zones/${this.config.zoneId}/dns_records?name=${encodeURIComponent(args.hostname)}`,
    })
    for (const record of resultsOf(body)) {
      const id = stringOf(record, 'id')
      const content = stringOf(record, 'content')
      if (id !== undefined && content !== undefined) return { id, content }
    }
    return undefined
  }

  async repointCname(args: { recordId: string; hostname: string; tunnelId: string }) {
    await this.http.send({
      operation: 'update dns record',
      method: 'PUT',
      path: `/zones/${this.config.zoneId}/dns_records/${args.recordId}`,
      payload: {
        type: 'CNAME',
        proxied: true,
        name: args.hostname,
        content: `${args.tunnelId}.cfargotunnel.com`,
      },
    })
  }

  async deleteDnsRecord(args: { recordId: string }): Promise<void> {
    await this.http.send({
      operation: 'delete dns record',
      method: 'DELETE',
      path: `/zones/${this.config.zoneId}/dns_records/${args.recordId}`,
      tolerateMissing: true,
    })
  }

  async deleteTunnel(args: { tunnelId: string }): Promise<void> {
    const tunnelPath = `/accounts/${this.config.accountId}/cfd_tunnel/${args.tunnelId}`
    await this.http.send({
      operation: 'clean up tunnel connections',
      method: 'DELETE',
      path: `${tunnelPath}/connections`,
      tolerateMissing: true,
    })
    await this.http.send({
      operation: 'delete tunnel',
      method: 'DELETE',
      path: tunnelPath,
      tolerateMissing: true,
    })
  }

  async findTunnelByName(args: { name: string }): Promise<{ id: string } | undefined> {
    const body = await this.http.request({
      operation: 'find tunnel',
      method: 'GET',
      path: this.tunnelListPath({ page: 1, filter: 'name', value: args.name }),
    })
    for (const tunnel of resultsOf(body)) {
      if (stringOf(tunnel, 'name') !== args.name) continue
      const id = stringOf(tunnel, 'id')
      if (id !== undefined) return { id }
    }
    return undefined
  }

  async getTunnel(args: { tunnelId: string }): Promise<{ id: string } | undefined> {
    const result = await this.http.send({
      operation: 'read tunnel',
      method: 'GET',
      path: `/accounts/${this.config.accountId}/cfd_tunnel/${args.tunnelId}`,
      tolerateMissing: true,
    })
    const id = stringOf(result, 'id')
    return id === undefined ? undefined : { id }
  }

  async tunnelToken(args: { tunnelId: string }): Promise<string> {
    const operation = 'read tunnel token'
    const body = await this.http.request({
      operation,
      method: 'GET',
      path: `/accounts/${this.config.accountId}/cfd_tunnel/${args.tunnelId}/token`,
    })
    if (typeof body.result === 'string' && body.result.length > 0) return body.result
    throw new PreviewUpstreamError(
      `cloudflare ${operation} returned an unexpected response (missing token)`,
    )
  }

  async ensureTunnel(args: { name: string }): Promise<{ id: string; token: string }> {
    const found = await this.findTunnelByName({ name: args.name })
    if (found === undefined) return await this.createTunnel({ name: args.name })
    return { id: found.id, token: await this.tunnelToken({ tunnelId: found.id }) }
  }

  async listTunnels(args: { namePrefix: string; page?: number }): Promise<TunnelSummary[]> {
    const tunnels: TunnelSummary[] = []
    for (let page = args.page ?? 1; ; page += 1) {
      const body = await this.http.request({
        operation: 'list tunnels',
        method: 'GET',
        path: this.tunnelListPath({ page, filter: 'include_prefix', value: args.namePrefix }),
      })
      const results = resultsOf(body)
      for (const tunnel of results) {
        const id = stringOf(tunnel, 'id')
        const name = stringOf(tunnel, 'name')
        if (id === undefined || name === undefined || !name.startsWith(args.namePrefix)) continue
        tunnels.push({ id, name, ...createdAtOf(tunnel) })
      }
      if (results.length === 0 || page >= totalPagesOf(body)) return tunnels
    }
  }

  async listDnsRecords(args: { nameSuffix: string }): Promise<DnsRecordSummary[]> {
    const records: DnsRecordSummary[] = []
    for (let page = 1; ; page += 1) {
      const body = await this.http.request({
        operation: 'list dns records',
        method: 'GET',
        path: `/zones/${this.config.zoneId}/dns_records?per_page=${DNS_PAGE_SIZE}&page=${page}`,
      })
      const results = resultsOf(body)
      for (const record of results) {
        const id = stringOf(record, 'id')
        const name = stringOf(record, 'name')
        const content = stringOf(record, 'content')
        if (id === undefined || name === undefined || content === undefined) continue
        if (!name.endsWith(args.nameSuffix)) continue
        records.push({ id, name, content, ...createdAtOf(record) })
      }
      if (results.length < DNS_PAGE_SIZE || page >= totalPagesOf(body)) return records
    }
  }

  private tunnelListPath(args: {
    page: number
    filter: 'name' | 'include_prefix'
    value: string
  }): string {
    const value = encodeURIComponent(args.value)
    return `/accounts/${this.config.accountId}/cfd_tunnel?${args.filter}=${value}&is_deleted=false&page=${args.page}`
  }
}

function createdAtOf(record: Record<string, unknown>): { createdAt?: string } {
  const createdAt = stringOf(record, 'created_at')
  return createdAt === undefined ? {} : { createdAt }
}
