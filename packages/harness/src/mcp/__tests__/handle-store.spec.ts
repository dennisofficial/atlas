import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin, EToolEffect } from '@dltech/atlas-core'

import { HandleStore } from '../bridge/handle-store'
import { EMcpServerStatus } from '../registry/handle-status'
import type { LoadedMcpSpec } from '../config'
import { InMemoryTransport, toolInfo } from './fixture-transport'

const spec = (name: string, extras?: Partial<LoadedMcpSpec>): LoadedMcpSpec => ({
  name,
  transport: { kind: 'stdio', command: 'fixture' },
  origin: EDefinitionOrigin.Project,
  definedIn: '/fixture',
  ...extras,
})

const inMemory = (baseline?: (transport: InMemoryTransport) => void): InMemoryTransport => {
  const transport = new InMemoryTransport()
  baseline?.(transport)
  return transport
}

const storeWith = async (args: {
  specs: readonly LoadedMcpSpec[]
  baselines: Partial<Record<string, (transport: InMemoryTransport) => void>>
  connectTimeoutMs?: number
}): Promise<HandleStore> => {
  const store = new HandleStore({
    specs: args.specs,
    transportFactory: (s) => inMemory(args.baselines[s.name]),
    ...(args.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: args.connectTimeoutMs }),
  })

  await store.connectAll()
  return store
}

describe('HandleStore boot', () => {
  it('connects every spec and folds its results by status', async () => {
    const specs: LoadedMcpSpec[] = [spec('alpha'), spec('beta', { disabled: true }), spec('gamma')]
    const store = await storeWith({
      specs,
      baselines: {
        gamma: (transport) => {
          transport.failsConnect = true
        },
      },
    })

    expect(store.statusOf({ serverId: 'alpha' })?.state.status).toBe(EMcpServerStatus.Connected)
    expect(store.statusOf({ serverId: 'beta' })?.state.status).toBe(EMcpServerStatus.Disabled)
    expect(store.statusOf({ serverId: 'gamma' })?.state).toEqual({
      status: EMcpServerStatus.Failed,
      error: 'the fixture refused to connect',
    })
  })

  it('marks a server Failed once it exceeds the timeout, without holding the others', async () => {
    const specs = [spec('slow'), spec('fast')]
    const store = await storeWith({
      specs,
      connectTimeoutMs: 50,
      baselines: {
        slow: (transport) => {
          transport.connectDelayMs = 200
        },
      },
    })

    expect(store.statusOf({ serverId: 'slow' })?.state.status).toBe(EMcpServerStatus.Failed)
    expect(store.statusOf({ serverId: 'fast' })?.state.status).toBe(EMcpServerStatus.Connected)
  })
})

describe('HandleStore declarations', () => {
  it('unions the tools of every connected handle and skips the rest', async () => {
    const specs = [spec('alpha'), spec('beta'), spec('off', { disabled: true })]
    const baselines: Partial<Record<string, (transport: InMemoryTransport) => void>> = {
      alpha: (transport) => {
        transport.tools = [toolInfo({ name: 'read', annotations: { readOnlyHint: true } })]
      },
      beta: (transport) => {
        transport.tools = [toolInfo({ name: 'write' })]
      },
    }

    const store = await storeWith({ specs, baselines })

    const names = store.declarations().map((declaration) => declaration.name)
    expect(names).toEqual(['mcp__alpha__read', 'mcp__beta__write'])
  })

  it('declares nothing from a server that cannot list tools', async () => {
    const store = await storeWith({
      specs: [spec('empty')],
      baselines: {
        empty: (transport) => {
          transport.capabilities = { tools: false, prompts: false, resources: false }
        },
      },
    })

    expect(store.statusOf({ serverId: 'empty' })?.state.status).toBe(EMcpServerStatus.Connected)
    expect(store.declarations()).toEqual([])
  })
})

describe('HandleStore find', () => {
  it('resolves a joined name to the bridge of the structural server and tool', async () => {
    const store = await storeWith({
      specs: [spec('alpha')],
      baselines: {
        alpha: (transport) => {
          transport.tools = [
            toolInfo({ name: 'first' }),
            toolInfo({ name: 'second', annotations: { destructiveHint: true } }),
          ]
        },
      },
    })

    const found = store.find('mcp__alpha__second')
    expect(found?.effect).toBe(EToolEffect.Destructive)
    expect(store.find('mcp__alpha__third')).toBeUndefined()
    expect(store.find('mcp__alpha__first')).toBeDefined()
  })

  it('closes every transport it opened', async () => {
    const made = new Map<string, InMemoryTransport>()
    const store = await storeWith({
      specs: [spec('alpha'), spec('beta')],
      baselines: {
        alpha: (transport) => {
          made.set('alpha', transport)
        },
        beta: (transport) => {
          made.set('beta', transport)
        },
      },
    })

    await store.closeAll()

    expect(made.get('alpha')?.closed).toBe(true)
    expect(made.get('beta')?.closed).toBe(true)
  })
})

describe('HandleStore token source and live config', () => {
  const httpSpec = (name: string, url = `https://${name}.example.com/mcp`): LoadedMcpSpec =>
    spec(name, { transport: { kind: 'http', url } })

  it('retries a NeedsAuth server once the source yields a token', async () => {
    let token: string | undefined
    const seenAuth: (string | null)[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as { id: string; method: string }
        seenAuth.push(request.headers.get('authorization'))
        if (request.headers.get('authorization') !== 'Bearer tok')
          return new Response('no', { status: 401 })
        const result =
          body.method === 'initialize' ? { capabilities: { tools: {} } } : { tools: [] }
        return Response.json({ jsonrpc: '2.0', id: body.id, result })
      },
    })
    try {
      const store = new HandleStore({
        specs: [httpSpec('posthog', `http://localhost:${server.port}/mcp`)],
        tokenSource: { currentToken: async () => token, reject: () => undefined },
      })
      await store.connectAll()
      expect(store.statusOf({ serverId: 'posthog' })?.state.status).toBe(EMcpServerStatus.NeedsAuth)

      await store.retryNeedsAuth()
      expect(store.statusOf({ serverId: 'posthog' })?.state.status).toBe(EMcpServerStatus.NeedsAuth)

      token = 'tok'
      await store.retryNeedsAuth()
      expect(store.statusOf({ serverId: 'posthog' })?.state.status).toBe(EMcpServerStatus.Connected)
      expect(seenAuth.at(-1)).toBe('Bearer tok')
    } finally {
      void server.stop(true)
    }
  })

  it('reconciles added, removed and changed specs', async () => {
    const transports = new Map<string, InMemoryTransport>()
    const store = new HandleStore({
      specs: [spec('keep'), spec('gone'), spec('edit')],
      transportFactory: (s) => {
        const transport = new InMemoryTransport()
        transports.set(`${s.name}:${JSON.stringify(s.transport)}`, transport)
        return transport
      },
    })
    await store.connectAll()
    const keepTransport = [...transports.entries()].find(([key]) => key.startsWith('keep'))?.[1]

    await store.reconcile({
      specs: [
        spec('keep'),
        spec('edit', { transport: { kind: 'stdio', command: 'other' } }),
        spec('fresh'),
      ],
    })

    expect(store.statusOf({ serverId: 'gone' })).toBeUndefined()
    expect(store.statusOf({ serverId: 'fresh' })?.state.status).toBe(EMcpServerStatus.Connected)
    expect(store.statusOf({ serverId: 'edit' })?.spec.transport).toEqual({
      kind: 'stdio',
      command: 'other',
    })
    expect(keepTransport?.closed).toBe(false)
  })
})
