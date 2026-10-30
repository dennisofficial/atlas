import { describe, expect, it } from 'bun:test'

import { CloudClient } from '../cloud-client'

const recordingClient = () => {
  const requests: { path: string; method: string; body: unknown }[] = []
  const client = new CloudClient({
    url: 'https://cloud.test',
    token: 'test-session',
    fetchFn: Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          path: new URL(String(input)).pathname,
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        })
        return Response.json({ result: {} })
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return { client, requests }
}

describe('CloudClient mutation bodies', () => {
  it('carries an MCP OAuth secret name whole in the JSON body for backup and removal', async () => {
    const { client, requests } = recordingClient()
    const name = 'mcp-oauth:https://mcp.example.test/mcp?scope=read#resource'

    await client.putSecret({ name, value: 'synthetic-encrypted-blob' })
    await client.deleteSecret({ name })

    expect(requests).toEqual([
      {
        path: '/v1/trpc/harnessSecrets.set',
        method: 'POST',
        body: { name, value: 'synthetic-encrypted-blob' },
      },
      { path: '/v1/trpc/harnessSecrets.remove', method: 'POST', body: { name } },
    ])
  })

  it('carries settings and MCP configuration identifiers without altering their values', async () => {
    const { client, requests } = recordingClient()

    await client.setSetting({ key: 'example/key', value: 'value' })
    await client.deleteSetting({ key: 'example/key' })
    await client.putMcpServer({ name: 'server#name', disabled: true })
    await client.deleteMcpServer({ name: 'server#name' })

    expect(requests).toEqual([
      {
        path: '/v1/trpc/settings.set',
        method: 'POST',
        body: { key: 'example/key', value: 'value' },
      },
      { path: '/v1/trpc/settings.remove', method: 'POST', body: { key: 'example/key' } },
      {
        path: '/v1/trpc/mcpServers.put',
        method: 'POST',
        body: { name: 'server#name', disabled: true },
      },
      { path: '/v1/trpc/mcpServers.remove', method: 'POST', body: { name: 'server#name' } },
    ])
  })
})
