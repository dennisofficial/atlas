import { beforeEach, describe, expect, it } from 'bun:test'
import {
  CloudflareTunnelClient,
  type CloudflareFetchFn,
  type CloudflareHttpRequest,
  type CloudflareHttpResponse,
} from '../cloudflare-tunnel.client'
import { CloudflareRecordExistsError, PreviewUpstreamError } from '../errors'

const config = { apiToken: 'cf-token', accountId: 'acct', zoneId: 'zone' }

const reply = (body: unknown, status = 200): CloudflareHttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
})

describe('CloudflareTunnelClient', () => {
  const calls: { url: string; request: CloudflareHttpRequest }[] = []
  let responses: CloudflareHttpResponse[] = []
  const fetchFn: CloudflareFetchFn = async (url, request) => {
    calls.push({ url, request })
    if (responses.length > 1) return responses.shift() as CloudflareHttpResponse
    return responses[0] ?? reply({ success: true, result: {} })
  }
  const client = new CloudflareTunnelClient(config, { fetchFn })
  const respond = (body: unknown, status = 200) => {
    responses = [reply(body, status)]
  }
  const respondWith = (...list: CloudflareHttpResponse[]) => {
    responses = list
  }

  beforeEach(() => {
    calls.length = 0
    responses = [reply({ success: true, result: {} })]
  })

  it('creates a remotely managed tunnel with the bearer token', async () => {
    respond({ success: true, result: { id: 'tun-1', token: 'tok-1' } })

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
    respond({ success: true, result: { id: 'rec-1' } })

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
    respond({ success: false, errors: [{ message: 'gone' }] }, 404)

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
    respond(
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
    respond({
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

  it('maps a non-2xx response to an upstream error carrying cloudflare messages', async () => {
    respond({ success: false, errors: [{ message: 'bad name' }] }, 400)

    const failure = await client.createTunnel({ name: 'x' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PreviewUpstreamError)
    expect((failure as Error).message).toContain('bad name')
  })

  it('maps success:false on a 200 to an upstream error', async () => {
    respond({ success: false, errors: [{ message: 'nope' }] })

    await expect(client.putIngress({ tunnelId: 't', rules: [] })).rejects.toBeInstanceOf(
      PreviewUpstreamError,
    )
  })

  it('rejects a create response missing the token', async () => {
    respond({ success: true, result: { id: 'tun-1' } })

    await expect(client.createTunnel({ name: 'x' })).rejects.toBeInstanceOf(PreviewUpstreamError)
  })

  it('finds a tunnel by its exact name', async () => {
    respond({
      success: true,
      result: [
        { id: 'tun-0', name: 'atlas-pod-10' },
        { id: 'tun-1', name: 'atlas-pod-1' },
      ],
    })

    const tunnel = await client.findTunnelByName({ name: 'atlas-pod-1' })

    expect(tunnel).toEqual({ id: 'tun-1' })
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel?name=atlas-pod-1&is_deleted=false&page=1',
    )
    expect(calls[0]?.request.method).toBe('GET')
  })

  it('answers no tunnel when only a longer name matches the search', async () => {
    respond({ success: true, result: [{ id: 'tun-0', name: 'atlas-pod-10' }] })

    expect(await client.findTunnelByName({ name: 'atlas-pod-1' })).toBeUndefined()
  })

  it('reads a tunnel and tolerates a 404', async () => {
    respond({ success: true, result: { id: 'tun-1', name: 'atlas-pod-1' } })
    expect(await client.getTunnel({ tunnelId: 'tun-1' })).toEqual({ id: 'tun-1' })

    respond({ success: false, errors: [{ message: 'gone' }] }, 404)
    expect(await client.getTunnel({ tunnelId: 'tun-1' })).toBeUndefined()
    expect(calls[1]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel/tun-1',
    )
  })

  it('reads the tunnel token from the bare result string', async () => {
    respond({ success: true, result: 'tok-1' })

    expect(await client.tunnelToken({ tunnelId: 'tun-1' })).toBe('tok-1')
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel/tun-1/token',
    )
  })

  it('rejects a tunnel token response that is not a string', async () => {
    respond({ success: true, result: {} })

    await expect(client.tunnelToken({ tunnelId: 'tun-1' })).rejects.toBeInstanceOf(
      PreviewUpstreamError,
    )
  })

  it('adopts the existing tunnel by name instead of creating another', async () => {
    respondWith(
      reply({ success: true, result: [{ id: 'tun-9', name: 'atlas-pod-1' }] }),
      reply({ success: true, result: 'tok-9' }),
    )

    expect(await client.ensureTunnel({ name: 'atlas-pod-1' })).toEqual({
      id: 'tun-9',
      token: 'tok-9',
    })
    expect(calls).toHaveLength(2)
  })

  it('creates the tunnel when no name matches', async () => {
    respondWith(
      reply({ success: true, result: [] }),
      reply({ success: true, result: { id: 'tun-2', token: 'tok-2' } }),
    )

    expect(await client.ensureTunnel({ name: 'atlas-pod-1' })).toEqual({
      id: 'tun-2',
      token: 'tok-2',
    })
    expect(calls[1]?.request.method).toBe('POST')
  })

  it('pages through every tunnel with the name prefix', async () => {
    respondWith(
      reply({
        success: true,
        result: [{ id: 'tun-1', name: 'atlas-pod-1', created_at: '2026-01-01T00:00:00Z' }],
        result_info: { page: 1, total_pages: 2 },
      }),
      reply({
        success: true,
        result: [
          { id: 'tun-2', name: 'atlas-pod-2' },
          { id: 'tun-3', name: 'other' },
        ],
        result_info: { page: 2, total_pages: 2 },
      }),
    )

    const tunnels = await client.listTunnels({ namePrefix: 'atlas-' })

    expect(tunnels).toEqual([
      { id: 'tun-1', name: 'atlas-pod-1', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'tun-2', name: 'atlas-pod-2' },
    ])
    expect(calls.map((call) => call.url.includes('page=2'))).toEqual([false, true])
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/cfd_tunnel?include_prefix=atlas-&is_deleted=false&page=1',
    )
  })

  it('pages through the zone and keeps only names under the domain', async () => {
    const firstPage = Array.from({ length: 100 }, (_unused, index) => ({
      id: `rec-${index}`,
      name: `${index}.elsewhere.dev`,
      content: 'x',
    }))
    respondWith(
      reply({ success: true, result: firstPage, result_info: { page: 1, total_pages: 2 } }),
      reply({
        success: true,
        result: [
          { id: 'rec-a', name: '3000-label0001.byatlas.dev', content: 'tun-1.cfargotunnel.com' },
          { id: 'rec-b', name: 'other.byatlas.dev', content: 'tun-2.cfargotunnel.com' },
        ],
        result_info: { page: 2, total_pages: 2 },
      }),
    )

    const records = await client.listDnsRecords({ nameSuffix: '.byatlas.dev' })

    expect(records).toEqual([
      { id: 'rec-a', name: '3000-label0001.byatlas.dev', content: 'tun-1.cfargotunnel.com' },
      { id: 'rec-b', name: 'other.byatlas.dev', content: 'tun-2.cfargotunnel.com' },
    ])
    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone/dns_records?per_page=100&page=1',
    )
    expect(calls[1]?.url).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone/dns_records?per_page=100&page=2',
    )
  })
})
