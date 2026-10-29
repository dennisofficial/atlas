import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import {
  CloudflareRecordExistsError,
  CloudflareTunnelClient,
  type CloudflareFetchFn,
  type CloudflareHttpRequest,
  type CloudflareHttpResponse,
} from './cloudflare-tunnel.client'

const env = new EnvService({
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: 'acct',
  CLOUDFLARE_ZONE_ID: 'zone',
})

const reply = (body: unknown, status = 200): CloudflareHttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
})

describe('CloudflareTunnelClient', () => {
  const calls: { url: string; request: CloudflareHttpRequest }[] = []
  let respond: () => CloudflareHttpResponse
  const fetchFn: CloudflareFetchFn = async (url, request) => {
    calls.push({ url, request })
    return respond()
  }
  const client = new CloudflareTunnelClient(env, { fetchFn })

  beforeEach(() => {
    calls.length = 0
    respond = () => reply({ success: true, result: {} })
  })

  it('creates a remotely managed tunnel with the bearer token', async () => {
    respond = () => reply({ success: true, result: { id: 'tun-1', token: 'tok-1' } })

    const tunnel = await client.createTunnel({ name: 'atlas-thr' })

    expect(tunnel).toEqual({ id: 'tun-1', token: 'tok-1' })
    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel')
    expect(calls[0]?.request.method).toBe('POST')
    expect(calls[0]?.request.headers.Authorization).toBe('Bearer cf-token')
    expect(JSON.parse(calls[0]?.request.body ?? '')).toEqual({
      name: 'atlas-thr',
      config_src: 'cloudflare',
    })
  })

  it('puts every rule followed by the catch-all', async () => {
    await client.putIngress({
      tunnelId: 'tun-1',
      rules: [{ hostname: 'a.byatlas.dev', port: 3000 }],
    })

    expect(calls[0]?.url).toContain('/accounts/acct/cfd_tunnel/tun-1/configurations')
    expect(calls[0]?.request.method).toBe('PUT')
    expect(JSON.parse(calls[0]?.request.body ?? '')).toEqual({
      config: {
        ingress: [
          {
            hostname: 'a.byatlas.dev',
            service: 'http://localhost:3000',
            originRequest: {},
          },
          { service: 'http_status:404' },
        ],
      },
    })
  })

  it('creates a proxied cname to the tunnel', async () => {
    respond = () => reply({ success: true, result: { id: 'rec-1' } })

    const record = await client.createCname({
      hostname: '3000-x.byatlas.dev',
      tunnelId: 'tun-1',
    })

    expect(record).toEqual({ id: 'rec-1' })
    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone/dns_records')
    expect(JSON.parse(calls[0]?.request.body ?? '')).toEqual({
      type: 'CNAME',
      proxied: true,
      name: '3000-x.byatlas.dev',
      content: 'tun-1.cfargotunnel.com',
    })
  })

  it('deletes a tunnel with cascade and a dns record, tolerating 404', async () => {
    respond = () => reply({ success: false, errors: [{ message: 'gone' }] }, 404)

    await client.deleteTunnel({ tunnelId: 'tun-1' })
    await client.deleteDnsRecord({ recordId: 'rec-1' })

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel/tun-1/connections',
      'https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel/tun-1',
      'https://api.cloudflare.com/client/v4/zones/zone/dns_records/rec-1',
    ])
  })

  it('clears connections before deleting the tunnel', async () => {
    await client.deleteTunnel({ tunnelId: 'tun-1' })

    expect(calls.map((call) => [call.request.method, call.url.split('/acct/')[1]])).toEqual([
      ['DELETE', 'cfd_tunnel/tun-1/connections'],
      ['DELETE', 'cfd_tunnel/tun-1'],
    ])
  })

  it('raises CloudflareRecordExistsError for an already-existing record', async () => {
    respond = () =>
      reply(
        {
          success: false,
          errors: [{ code: 81057, message: 'Record already exists.' }],
        },
        400,
      )

    const failure = await client
      .createCname({ hostname: 'h.byatlas.dev', tunnelId: 'tun-1' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudflareRecordExistsError)
  })

  it('finds a dns record by name', async () => {
    respond = () =>
      reply({
        success: true,
        result: [{ id: 'rec-9', content: 'tun-0.cfargotunnel.com' }],
      })

    const record = await client.findDnsRecord({ hostname: 'h.byatlas.dev' })

    expect(record).toEqual({ id: 'rec-9', content: 'tun-0.cfargotunnel.com' })
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone/dns_records?name=h.byatlas.dev',
    )
    expect(calls[0]?.request.method).toBe('GET')
  })

  it('repoints a dns record at a tunnel', async () => {
    await client.repointCname({
      recordId: 'rec-9',
      hostname: 'h.byatlas.dev',
      tunnelId: 'tun-1',
    })

    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/zones/zone/dns_records/rec-9')
    expect(calls[0]?.request.method).toBe('PUT')
    expect(JSON.parse(calls[0]?.request.body ?? '')).toEqual({
      type: 'CNAME',
      proxied: true,
      name: 'h.byatlas.dev',
      content: 'tun-1.cfargotunnel.com',
    })
  })

  it('maps a non-2xx response to a bad gateway carrying cloudflare messages', async () => {
    respond = () => reply({ success: false, errors: [{ message: 'bad name' }] }, 400)

    const failure = await client.createTunnel({ name: 'x' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BadGatewayException)
    expect((failure as Error).message).toContain('bad name')
  })

  it('maps success:false on a 200 to a bad gateway', async () => {
    respond = () => reply({ success: false, errors: [{ message: 'nope' }] })

    await expect(client.putIngress({ tunnelId: 't', rules: [] })).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('rejects a create response missing the token', async () => {
    respond = () => reply({ success: true, result: { id: 'tun-1' } })

    await expect(client.createTunnel({ name: 'x' })).rejects.toBeInstanceOf(BadGatewayException)
  })
})
