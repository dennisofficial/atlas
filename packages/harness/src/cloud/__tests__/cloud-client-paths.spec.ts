import { describe, expect, it } from 'bun:test'

import { CloudClient } from '../cloud-client'

const recordingClient = () => {
  const requests: { path: string; method: string }[] = []
  const client = new CloudClient({
    url: 'https://cloud.test',
    token: 'test-session',
    fetchFn: Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ path: new URL(String(input)).pathname, method: init?.method ?? 'GET' })
      return new Response(null, { status: 204 })
    }, { preconnect: fetch.preconnect }),
  })
  return { client, requests }
}

describe('CloudClient path parameters', () => {
  it('keeps an MCP OAuth secret name in one URL segment for backup and removal', async () => {
    const { client, requests } = recordingClient()
    const name = 'mcp-oauth:https://mcp.example.test/mcp?scope=read#resource'

    await client.putSecret({ name, value: 'synthetic-encrypted-blob' })
    await client.deleteSecret({ name })

    expect(requests).toEqual([
      { path: `/v1/secrets/${encodeURIComponent(name)}`, method: 'PUT' },
      { path: `/v1/secrets/${encodeURIComponent(name)}`, method: 'DELETE' },
    ])
    expect(decodeURIComponent(requests[0]?.path.split('/').at(-1) ?? '')).toBe(name)
  })

  it('encodes settings and MCP configuration identifiers without altering their values', async () => {
    const { client, requests } = recordingClient()

    await client.setSetting({ key: 'example/key', value: 'value' })
    await client.deleteSetting({ key: 'example/key' })
    await client.putMcpServer({ name: 'server#name', disabled: true })
    await client.deleteMcpServer({ name: 'server#name' })

    expect(requests).toEqual([
      { path: '/v1/settings/example%2Fkey', method: 'PUT' },
      { path: '/v1/settings/example%2Fkey', method: 'DELETE' },
      { path: '/v1/mcp-servers/server%23name', method: 'PUT' },
      { path: '/v1/mcp-servers/server%23name', method: 'DELETE' },
    ])
  })
})
