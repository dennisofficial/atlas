import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin, toThreadId } from '@dltech/atlas-core'
import { EMcpOauthAccessOutcome } from '@dltech/atlas-wire/web'

import { HandleStore } from '../bridge/handle-store'
import { CloudMcpTokenSource } from '../cloud/cloud-mcp-token-source'
import type { LoadedMcpSpec } from '../config'
import { EMcpServerStatus } from '../registry/handle-status'
import { InMemoryTransport, toolInfo } from './fixture-transport'

const httpSpec = (name: string, url: string, headers?: Record<string, string>): LoadedMcpSpec => ({
  name,
  transport: { kind: 'http', url, ...(headers === undefined ? {} : { headers }) },
  origin: EDefinitionOrigin.Project,
  definedIn: '/fixture',
})

const invocation = () => ({
  input: {},
  signal: new AbortController().signal,
  idempotencyKey: 'k',
  projectDirectory: '/repo',
  threadId: toThreadId('thread-1'),
})

const serverAccepting = (accepted: () => string) => {
  const seen: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = (await request.json()) as { id: string; method: string }
      const auth = request.headers.get('authorization')
      seen.push(auth)
      if (auth !== `Bearer ${accepted()}`) return new Response('no', { status: 401 })
      const result =
        body.method === 'initialize'
          ? { capabilities: { tools: {} } }
          : body.method === 'tools/list'
            ? { tools: [{ name: 'ping' }] }
            : { content: [{ type: 'text', text: 'pong' }] }
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    },
  })
  return { server, seen, url: `http://localhost:${server.port}/mcp` }
}

const granted = (accessToken: string) => ({ outcome: EMcpOauthAccessOutcome.Granted, accessToken })

describe('HandleStore tool-call 401', () => {
  it('reconnects with a fresh token and reports the rejected one to the API', async () => {
    let valid = 'old'
    const rig = serverAccepting(() => valid)
    const apiCalls: { serverUrl: string; rejectedAccessToken?: string | undefined }[] = []
    const answers = [granted('old'), granted('new')]
    const store = new HandleStore({
      specs: [httpSpec('ph', rig.url)],
      tokenSource: new CloudMcpTokenSource({
        access: async (args) => {
          apiCalls.push(args)
          return answers.shift() ?? { outcome: EMcpOauthAccessOutcome.NeedsAuth }
        },
      }),
    })
    try {
      await store.connectAll()
      expect(store.statusOf({ serverId: 'ph' })?.state.status).toBe(EMcpServerStatus.Connected)

      valid = 'new'
      const tool = store.find('mcp__ph__ping')
      await tool?.invoke(invocation())
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(apiCalls.at(-1)).toEqual({ serverUrl: rig.url, rejectedAccessToken: 'old' })
      expect(store.statusOf({ serverId: 'ph' })?.state.status).toBe(EMcpServerStatus.Connected)
      expect(rig.seen.at(-1)).toBe('Bearer new')
    } finally {
      await store.closeAll()
      void rig.server.stop(true)
    }
  })

  it('lands in NeedsAuth when the reconnect cannot get a token', async () => {
    let valid = 'old'
    const rig = serverAccepting(() => valid)
    const answers = [granted('old')]
    const store = new HandleStore({
      specs: [httpSpec('ph', rig.url)],
      tokenSource: new CloudMcpTokenSource({
        access: async () => answers.shift() ?? { outcome: EMcpOauthAccessOutcome.NeedsAuth },
      }),
    })
    try {
      await store.connectAll()
      valid = 'revoked'
      await store.find('mcp__ph__ping')?.invoke(invocation())
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(store.statusOf({ serverId: 'ph' })?.state.status).toBe(EMcpServerStatus.NeedsAuth)
    } finally {
      await store.closeAll()
      void rig.server.stop(true)
    }
  })
})

describe('HandleStore authorization headers', () => {
  it('never asks the token source for a server that carries its own Authorization header', async () => {
    const rig = serverAccepting(() => 'static')
    const asked: string[] = []
    const store = new HandleStore({
      specs: [httpSpec('own', rig.url, { Authorization: 'Bearer static' })],
      tokenSource: {
        currentToken: async ({ serverUrl }) => {
          asked.push(serverUrl)
          return 'other'
        },
        reject: () => undefined,
      },
    })
    try {
      await store.connectAll()
      await store.retryNeedsAuth()

      expect(store.statusOf({ serverId: 'own' })?.state.status).toBe(EMcpServerStatus.Connected)
      expect(asked).toEqual([])
    } finally {
      await store.closeAll()
      void rig.server.stop(true)
    }
  })
})

describe('HandleStore reopen serialisation', () => {
  it('keeps one transport when reconnects overlap and closes the loser', async () => {
    const made: InMemoryTransport[] = []
    const store = new HandleStore({
      specs: [
        {
          name: 's',
          transport: { kind: 'stdio', command: 'x' },
          origin: EDefinitionOrigin.Project,
          definedIn: '/f',
        },
      ],
      transportFactory: () => {
        const transport = new InMemoryTransport()
        transport.tools = [toolInfo({ name: 't' })]
        transport.connectDelayMs = made.length === 1 ? 40 : 5
        made.push(transport)
        return transport
      },
    })
    await store.connectAll()
    await Promise.all([store.reconnect({ serverId: 's' }), store.reconnect({ serverId: 's' })])

    const live = made.filter((transport) => !transport.closed)
    expect(live).toHaveLength(1)
    expect(store.statusOf({ serverId: 's' })?.transport).toBe(live[0]!)
  })

  it('does not install a handle opened after the store closed', async () => {
    const made: InMemoryTransport[] = []
    const store = new HandleStore({
      specs: [
        {
          name: 's',
          transport: { kind: 'stdio', command: 'x' },
          origin: EDefinitionOrigin.Project,
          definedIn: '/f',
        },
      ],
      transportFactory: () => {
        const transport = new InMemoryTransport()
        transport.connectDelayMs = 20
        made.push(transport)
        return transport
      },
    })
    const connecting = store.connectAll()
    await store.closeAll()
    await connecting

    expect(made.every((transport) => transport.closed)).toBe(true)
    expect(store.servers()).toEqual([])
  })
})
