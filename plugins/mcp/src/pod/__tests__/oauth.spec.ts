import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { McpCloudRow } from '../../core'
import { EMcpServerStatus, McpStore } from '../store'
import { fakeDaemon, rig } from './support'

const SERVER_URL = 'https://mcp.test/mcp'

type Captured = { method: string; headers: Record<string, string>; body: Record<string, unknown> }

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const handshake = (request: Captured): Response => {
  if (request.method === 'DELETE') return new Response(null, { status: 200 })
  if (request.body['method'] === 'initialize')
    return json({
      jsonrpc: '2.0',
      id: request.body['id'],
      result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's' } },
    })
  if (request.body['method'] === 'tools/list')
    return json({ jsonrpc: '2.0', id: request.body['id'], result: { tools: [] } })
  return new Response(null, { status: 202 })
}

const stubFetch = (
  answer: (request: Captured) => Response,
): { requests: Captured[]; restore: () => void } => {
  const original = globalThis.fetch
  const requests: Captured[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Captured = {
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    }
    requests.push(request)
    return answer(request)
  }) as typeof globalThis.fetch
  return {
    requests,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const rowsOf = (accessToken?: string): readonly McpCloudRow[] => [
  {
    source: 'user',
    spec: { name: 'posthog', transport: { kind: 'http', url: SERVER_URL } },
    ...(accessToken === undefined ? {} : { accessToken }),
  },
]

const start = async (rows: readonly McpCloudRow[]) => {
  const daemon = fakeDaemon()
  const config = { read: async () => ({ rows, rejections: [] }) }
  const store = new McpStore({
    ctx: rig(daemon),
    config,
    connectTimeoutMs: 200,
    reconcileBudgetMs: 200,
  })
  await store.boot()
  return store
}

const initializeRequest = (requests: readonly Captured[]): Captured | undefined =>
  requests.find((request) => request.body['method'] === 'initialize')

describe('a cloud http server with an oauth grant', () => {
  it('sends the access token as a bearer header on initialize', async () => {
    const fetched = stubFetch(handshake)
    try {
      const store = await start(rowsOf('token-1'))

      expect(initializeRequest(fetched.requests)?.headers['authorization']).toBe('Bearer token-1')
      expect(store.servers().map((server) => server.status)).toEqual([EMcpServerStatus.Connected])
    } finally {
      fetched.restore()
    }
  })

  it('sends no authorization header without a grant', async () => {
    const fetched = stubFetch(handshake)
    try {
      await start(rowsOf())

      expect(initializeRequest(fetched.requests)?.headers['authorization']).toBeUndefined()
    } finally {
      fetched.restore()
    }
  })

  it('reports needs-auth when the server answers 401', async () => {
    const fetched = stubFetch((request) =>
      request.method === 'DELETE'
        ? new Response(null, { status: 200 })
        : new Response('no', { status: 401 }),
    )
    try {
      const store = await start(rowsOf('stale-token'))

      expect(store.servers()).toEqual([
        {
          name: 'posthog',
          origin: EDefinitionOrigin.User,
          transport: 'http',
          status: EMcpServerStatus.NeedsAuth,
          tools: 0,
          reason:
            "the 'posthog' MCP server needs a sign-in; call operator_mcp_sign_in to start one",
        },
      ])
    } finally {
      fetched.restore()
    }
  })
})
