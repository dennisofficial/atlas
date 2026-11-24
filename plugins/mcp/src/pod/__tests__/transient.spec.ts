import { EDefinitionOrigin } from '@dltech/atlas-core'
import {
  EMcpToken,
  EMPTY_MCP_CONTROL,
  type PodMcpControl,
  type PodResource,
} from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import type { McpCloudRow } from '../../core'
import { McpClients } from '../clients'
import { MCP_TOOLS, mcpToolsResource } from '../resources'
import { McpSignInBook } from '../sign-in-book'
import { EMcpServerStatus, type McpToolsSnapshot } from '../snapshot'
import { McpUnavailableError } from '../types'
import { eventOf, recordingRig, snapshotEventOf } from './recording'
import { fakeDaemon } from './support'

const SERVER_URL = 'https://mcp.test/mcp'

const rowsOf = (): readonly McpCloudRow[] => [
  { source: 'user', spec: { name: 'posthog', transport: { kind: 'http', url: SERVER_URL } } },
]

const controlOf = (token: PodMcpControl['token']): PodMcpControl => ({
  ...EMPTY_MCP_CONTROL,
  token,
})

const granted = controlOf(async () => ({ kind: EMcpToken.Granted, accessToken: 'token-1' }))

const unavailable = (reason: string): PodMcpControl =>
  controlOf(async () => ({ kind: EMcpToken.Unavailable, reason }))

type Captured = { method: string; body: Record<string, unknown> }

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const handshake = (request: Captured): Response => {
  if (request.method === 'DELETE') return new Response(null, { status: 200 })
  if (request.body['method'] === 'initialize')
    return json({
      jsonrpc: '2.0',
      id: request.body['id'],
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        serverInfo: { name: 's' },
        instructions: 'PostHog first.',
      },
    })
  if (request.body['method'] === 'tools/list')
    return json({
      jsonrpc: '2.0',
      id: request.body['id'],
      result: { tools: [{ name: 'query', inputSchema: { type: 'object' } }] },
    })
  return new Response(null, { status: 202 })
}

const stubFetch = (answer: (request: Captured) => Response): { restore: () => void } => {
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) =>
    answer({
      method: init?.method ?? 'GET',
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    })) as typeof globalThis.fetch
  return {
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const resourceOf = (): PodResource<McpToolsSnapshot> =>
  mcpToolsResource({
    config: { read: async () => ({ rows: rowsOf(), rejections: [] }) },
    connectTimeoutMs: 200,
    signIns: new McpSignInBook(),
  })

const withDaemon = <T>(run: (daemon: ReturnType<typeof fakeDaemon>) => Promise<T>): Promise<T> =>
  run(fakeDaemon())

const connectedRun = async (args: {
  resource: PodResource<McpToolsSnapshot>
  daemon: ReturnType<typeof fakeDaemon>
}): Promise<{ value: McpToolsSnapshot; records: ReturnType<typeof snapshotEventOf>[] }> => {
  const first = recordingRig(args.daemon, { mcp: granted })
  const value = await args.resource.load({ ctx: first.ctx, directory: '/repo' })
  const drafts = args.resource.announce?.(value, first.ctx) ?? []
  return {
    value,
    records: [
      snapshotEventOf({ resource: MCP_TOOLS, value, seq: 1 }),
      ...drafts.map((draft, index) => eventOf(draft, index + 2)),
    ],
  }
}

describe('a transient token failure', () => {
  it('carries the last entry untouched and announces nothing', async () => {
    const fetched = stubFetch(handshake)
    try {
      await withDaemon(async (daemon) => {
        const resource = resourceOf()
        const first = await connectedRun({ resource, daemon })
        const earlier = first.value.servers[0]
        if (earlier === undefined) throw new Error('the first load recorded no server')
        expect(earlier.status).toBe(EMcpServerStatus.Connected)

        const second = recordingRig(daemon, {
          records: first.records,
          mcp: unavailable('the authorization server is unavailable; retry shortly'),
        })
        const value = await resource.load({ ctx: second.ctx, directory: '/repo' })

        expect(value.servers).toEqual([{ ...earlier, retry: true }])
        expect(resource.stale?.(value)).toBe(true)
        expect(resource.announce?.(value, second.ctx)).toEqual([])
      })
    } finally {
      fetched.restore()
    }
  })

  it('treats a thrown token port as transient, not as a sign-out', async () => {
    const fetched = stubFetch(handshake)
    try {
      await withDaemon(async (daemon) => {
        const resource = resourceOf()
        const first = await connectedRun({ resource, daemon })
        const second = recordingRig(daemon, {
          records: first.records,
          mcp: controlOf(async () => {
            throw new Error('the lease was lost: stale-epoch')
          }),
        })
        const value = await resource.load({ ctx: second.ctx, directory: '/repo' })

        expect(value.servers[0]).toMatchObject({
          status: EMcpServerStatus.Connected,
          retry: true,
        })
        expect(value.servers[0]?.tools.map((tool) => tool.name)).toEqual(['query'])
        expect(resource.announce?.(value, second.ctx)).toEqual([])
      })
    } finally {
      fetched.restore()
    }
  })

  it('retries on the next load, clears the flag and still announces nothing unchanged', async () => {
    const fetched = stubFetch(handshake)
    try {
      await withDaemon(async (daemon) => {
        const resource = resourceOf()
        const first = await connectedRun({ resource, daemon })
        const second = recordingRig(daemon, {
          records: first.records,
          mcp: unavailable('the authorization server is unavailable; retry shortly'),
        })
        const carried = await resource.load({ ctx: second.ctx, directory: '/repo' })
        const third = recordingRig(daemon, {
          records: [
            ...first.records,
            snapshotEventOf({ resource: MCP_TOOLS, value: carried, seq: 9 }),
          ],
          mcp: granted,
        })
        const value = await resource.load({ ctx: third.ctx, directory: '/repo' })

        expect(value).toEqual(first.value)
        expect(resource.stale?.(value)).toBe(false)
        expect(resource.announce?.(value, third.ctx)).toEqual([])
      })
    } finally {
      fetched.restore()
    }
  })

  it('shows an unavailable server once when there is no earlier entry to carry', async () => {
    await withDaemon(async (daemon) => {
      const resource = resourceOf()
      const recording = recordingRig(daemon, {
        mcp: unavailable('the authorization server is unavailable; retry shortly'),
      })
      const value = await resource.load({ ctx: recording.ctx, directory: '/repo' })

      expect(value.servers).toEqual([
        {
          name: 'posthog',
          origin: EDefinitionOrigin.User,
          transportKind: 'http',
          configHash: expect.any(String),
          status: EMcpServerStatus.Unavailable,
          reason: 'the authorization server is unavailable; retry shortly',
          tools: [],
          retry: true,
        },
      ])
    })
  })
})

describe('a live tool call', () => {
  it('fails with the retryable reason instead of asking for a sign-in', async () => {
    const ctx = recordingRig(fakeDaemon(), {
      mcp: unavailable('the authorization server is unavailable; retry shortly'),
    }).ctx
    const clients = new McpClients({ timeoutMs: 200 })

    const error = await clients
      .clientFor(
        async () => ({
          name: 'posthog',
          origin: EDefinitionOrigin.User,
          definedIn: 'the cloud',
          source: 'cloud',
          transport: { kind: 'http', url: SERVER_URL },
        }),
        ctx,
      )
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(McpUnavailableError)
    expect((error as Error).message).toBe('the authorization server is unavailable; retry shortly')
  })
})

describe('a real sign-out', () => {
  it('still reports needs-auth', async () => {
    const fetched = stubFetch((request) =>
      request.method === 'DELETE'
        ? new Response(null, { status: 200 })
        : new Response('no', { status: 401 }),
    )
    try {
      await withDaemon(async (daemon) => {
        const resource = resourceOf()
        const recording = recordingRig(daemon, {
          mcp: controlOf(async () => ({ kind: EMcpToken.SignIn })),
        })
        const value = await resource.load({ ctx: recording.ctx, directory: '/repo' })

        expect(value.servers[0]?.status).toBe(EMcpServerStatus.NeedsAuth)
        expect(value.servers[0]?.retry).toBeUndefined()
      })
    } finally {
      fetched.restore()
    }
  })
})
