import { EMcpToken, type McpToken } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { HttpClient } from '../http'
import { McpUnauthorizedError } from '../types'

const SERVER_URL = 'https://mcp.test/mcp'

type Captured = { method: string; headers: Record<string, string>; body: Record<string, unknown> }

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const handshake = (request: Captured): Response => {
  if (request.body['method'] === 'initialize')
    return json({
      jsonrpc: '2.0',
      id: request.body['id'],
      result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's' } },
    })
  if (request.body['method'] === 'tools/list')
    return json({
      jsonrpc: '2.0',
      id: request.body['id'],
      result: { tools: [{ name: 'query', inputSchema: { type: 'object' } }] },
    })
  return new Response(null, { status: 202 })
}

const stubFetch = (
  answer: (request: Captured) => Response,
): { requests: Captured[]; posts: () => Captured[]; restore: () => void } => {
  const original = globalThis.fetch
  const requests: Captured[] = []
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
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
    posts: () => requests.filter((request) => request.method === 'POST'),
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const granted = (accessToken: string): McpToken => ({ kind: EMcpToken.Granted, accessToken })

const clientOf = (tokens: readonly McpToken[]): { client: HttpClient; calls: () => number } => {
  let asked = 0
  const token = async (): Promise<McpToken> => {
    const next = tokens[asked]
    if (next === undefined) throw new Error('the test allowed no more token refreshes')
    asked += 1
    return next
  }
  return {
    client: new HttpClient({
      serverId: 'posthog',
      transport: { kind: 'http', url: SERVER_URL },
      token,
    }),
    calls: () => asked,
  }
}

const rejectsWithUnauthorized = async (client: HttpClient): Promise<McpUnauthorizedError> => {
  const thrown = await client.connect().catch((error: unknown) => error)
  if (!(thrown instanceof McpUnauthorizedError))
    throw new Error(`expected McpUnauthorizedError, got ${String(thrown)}`)
  return thrown
}

describe('an http client with a token provider', () => {
  it('refreshes the token once after a 401 and retries the request', async () => {
    const fetched = stubFetch((request) =>
      request.headers['authorization'] === 'Bearer token-2'
        ? handshake(request)
        : new Response('no', { status: 401 }),
    )
    try {
      const { client, calls } = clientOf([granted('token-1'), granted('token-2')])
      const connection = await client.connect()

      expect(connection.tools.map((tool) => tool.name)).toEqual(['query'])
      expect(fetched.posts().map((request) => request.headers['authorization'])).toEqual([
        'Bearer token-1',
        'Bearer token-2',
        'Bearer token-2',
        'Bearer token-2',
      ])
      expect(calls()).toBe(2)
    } finally {
      fetched.restore()
    }
  })

  it('shares one refresh between parallel calls that are both unauthorized', async () => {
    const fetched = stubFetch((request) => {
      if (request.body['method'] !== 'tools/call') return handshake(request)
      return request.headers['authorization'] === 'Bearer token-2'
        ? json({ jsonrpc: '2.0', id: request.body['id'], result: { content: [] } })
        : new Response('no', { status: 401 })
    })
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let asked = 0
    const client = new HttpClient({
      serverId: 'posthog',
      transport: { kind: 'http', url: SERVER_URL },
      token: async () => {
        asked += 1
        if (asked === 1) return granted('token-1')
        await gate
        return granted('token-2')
      },
    })
    try {
      await client.connect()
      const calls = Promise.all([
        client.callTool({ name: 'query', input: {} }),
        client.callTool({ name: 'query', input: {} }),
      ])
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(asked).toBe(2)
      release()
      expect(await calls).toEqual([{ content: [] }, { content: [] }])
      expect(asked).toBe(2)
      expect(
        fetched
          .posts()
          .filter(
            (request) =>
              request.body['method'] === 'tools/call' &&
              request.headers['authorization'] === 'Bearer token-2',
          ),
      ).toHaveLength(2)
    } finally {
      fetched.restore()
    }
  })

  it('asks for the token once while no 401 arrives', async () => {
    const fetched = stubFetch(handshake)
    try {
      const { client, calls } = clientOf([granted('token-1')])
      await client.connect()
      await client.callTool({ name: 'query', input: {} })

      expect(calls()).toBe(1)
      expect(
        fetched.posts().every((request) => request.headers['authorization'] === 'Bearer token-1'),
      ).toBe(true)
    } finally {
      fetched.restore()
    }
  })

  it('throws unauthorized on a second 401 instead of refreshing again', async () => {
    const fetched = stubFetch((request) =>
      request.method === 'POST'
        ? new Response('no', { status: 401 })
        : new Response(null, { status: 200 }),
    )
    try {
      const { client, calls } = clientOf([granted('token-1'), granted('token-2')])
      const error = await rejectsWithUnauthorized(client)

      expect(error.message).toBe(
        "the 'posthog' MCP server needs a sign-in; call operator_mcp_sign_in to start one",
      )
      expect(calls()).toBe(2)
    } finally {
      fetched.restore()
    }
  })

  it('throws unauthorized when the refresh finds no available token', async () => {
    const fetched = stubFetch((request) =>
      request.method === 'POST'
        ? new Response('no', { status: 401 })
        : new Response(null, { status: 200 }),
    )
    try {
      const { client, calls } = clientOf([
        granted('token-1'),
        { kind: EMcpToken.Unavailable, reason: 'the authorization server is unavailable' },
      ])
      await rejectsWithUnauthorized(client)

      expect(calls()).toBe(2)
      expect(fetched.posts()).toHaveLength(1)
    } finally {
      fetched.restore()
    }
  })

  it('sends no authorization header while the provider grants none', async () => {
    const fetched = stubFetch(handshake)
    try {
      const { client } = clientOf([{ kind: EMcpToken.SignIn }])
      await client.connect()

      expect(fetched.posts()[0]?.headers['authorization']).toBeUndefined()
    } finally {
      fetched.restore()
    }
  })
})
