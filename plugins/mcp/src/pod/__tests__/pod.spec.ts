import { EDefinitionOrigin, EToolEffect, toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { EMcpRejection, EMcpViewStatus, type McpCloudRow } from '../../core'
import { mcpPod } from '..'
import { McpBridgeTool } from '../bridge-tool'
import { EMcpServerStatus, McpStore } from '../store'
import { fakeDaemon, invocation, rig, type FakeBehaviour } from './support'

const docsTransport = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const rowsOf = (transport = docsTransport): readonly McpCloudRow[] => [
  { source: 'user', spec: { name: 'docs', transport } },
]

const start = async (args: {
  behaviours?: Readonly<Record<string, FakeBehaviour>>
  rows?: readonly McpCloudRow[]
  repoFiles?: Readonly<Record<string, string>>
  eventLineBytes?: number
}) => {
  const daemon = fakeDaemon(
    args.behaviours ?? {},
    args.eventLineBytes === undefined ? {} : { eventLineBytes: args.eventLineBytes },
  )
  for (const [path, text] of Object.entries(args.repoFiles ?? {})) daemon.files.set(path, text)
  const config = { read: async () => ({ rows: args.rows ?? rowsOf(), rejections: [] }) }
  const ctx = rig(daemon)
  const store = new McpStore({
    ctx,
    config,
    connectTimeoutMs: 200,
    reconcileBudgetMs: 200,
  })
  await store.boot()
  return { daemon, ctx, store, config }
}

const searchTool = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
}

describe('lifecycle', () => {
  it('connects a stdio server in the sandbox and lists its tools', async () => {
    const { daemon, store } = await start({
      behaviours: { docs: { tools: [searchTool, { name: 'read' }], instructions: 'Docs first.' } },
    })
    expect(store.servers()).toEqual([
      {
        name: 'docs',
        origin: EDefinitionOrigin.User,
        transport: 'stdio',
        status: EMcpServerStatus.Connected,
        tools: 2,
        reason: undefined,
      },
    ])
    expect(store.instructionsOf('docs')).toBe('Docs first.')
    expect(daemon.spawns).toHaveLength(1)
    expect(daemon.spawns[0]?.command).toBe('bun')
    expect(daemon.spawns[0]?.args).toEqual(['run', 'server'])
    expect(daemon.spawns[0]?.env).toBeUndefined()
  })

  it('resolves responses from daemon frames without reading the line buffer', async () => {
    const { daemon } = await start({ behaviours: { docs: { tools: [searchTool] } } })
    expect(daemon.reads()).toBe(0)
  })

  it('recovers a line the daemon refused to publish through mcp.read', async () => {
    const { daemon, store } = await start({
      behaviours: { docs: { tools: [searchTool] } },
      eventLineBytes: 80,
    })
    expect(store.servers()[0]?.status).toBe(EMcpServerStatus.Connected)
    expect(store.tools().map((tool) => tool.name)).toEqual(['mcp__docs__search'])
    expect(daemon.reads()).toBeGreaterThan(0)
  })

  it('reports a failed server with the first lines of its stderr', async () => {
    const { store } = await start({
      behaviours: {
        docs: {
          exit: { exitCode: 1, signal: null },
          stderr: ['Error: missing token', '    at boot (server.ts:1:1)'],
        },
      },
    })
    const [server] = store.servers()
    expect(server?.status).toBe(EMcpServerStatus.Failed)
    expect(server?.reason).toContain('Error: missing token')
    expect(server?.reason).toContain('exited with code 1')
    expect(store.tools()).toEqual([])
  })

  it('reuses a live connection, drops a removed server and starts a new one on reconcile', async () => {
    const daemon = fakeDaemon({
      docs: { tools: [searchTool] },
      tickets: { tools: [{ name: 'list' }] },
    })
    let rows: readonly McpCloudRow[] = [
      { source: 'user', spec: { name: 'docs', transport: docsTransport } },
    ]
    const store = new McpStore({
      ctx: rig(daemon),
      config: { read: async () => ({ rows, rejections: [] }) },
      connectTimeoutMs: 200,
      reconcileBudgetMs: 200,
    })
    await store.boot()
    expect(daemon.spawns.map((spawn) => spawn.serverId)).toEqual(['docs'])

    await store.reconcile()
    expect(daemon.spawns).toHaveLength(1)

    rows = [{ source: 'project', spec: { name: 'tickets', transport: docsTransport } }]
    await store.reconcile()
    expect(daemon.closed).toContain('docs')
    expect(daemon.spawns.map((spawn) => spawn.serverId)).toEqual(['docs', 'tickets'])
    expect(store.servers().map((server) => server.name)).toEqual(['tickets'])
  })
})

describe('config through the pod', () => {
  it('lets a repo file override a cloud row', async () => {
    const { daemon } = await start({
      repoFiles: {
        '/repo/.atlas/mcp.json': JSON.stringify({
          mcpServers: { docs: { transport: { kind: 'stdio', command: 'repo-server' } } },
        }),
      },
    })
    expect(daemon.spawns[0]?.command).toBe('repo-server')
  })

  it('lets a repo disabled stub hide the cloud row it names', async () => {
    const { daemon, store } = await start({
      repoFiles: {
        '/repo/.atlas/mcp.json': JSON.stringify({ mcpServers: { docs: { disabled: true } } }),
      },
    })
    expect(store.servers()).toEqual([])
    expect(daemon.spawns).toEqual([])
  })

  it('turns an entry that fails to parse into a failed row carrying the parse detail', async () => {
    const { store } = await start({
      rows: [],
      repoFiles: { '/repo/.atlas/mcp.json': JSON.stringify({ mcpServers: { docs: {} } }) },
    })
    const [row] = store.rows()
    expect(row?.name).toBe('docs')
    expect(row?.transport).toBeNull()
    expect(row?.status).toBe(EMcpViewStatus.Failed)
    expect(row?.toolCount).toBe(0)
    expect(row?.reason).toContain('transport')
  })

  it("reads Claude's .mcp.json when no native definition names the server", async () => {
    const { daemon } = await start({
      rows: [],
      repoFiles: {
        '/repo/.mcp.json': JSON.stringify({ docs: { command: 'compat-server' } }),
      },
    })
    expect(daemon.spawns[0]?.command).toBe('compat-server')
  })
})

describe('bridge tools', () => {
  const boot = async (behaviours: Readonly<Record<string, FakeBehaviour>>) => {
    const { ctx } = await start({ behaviours })
    const pod = mcpPod({ config: { read: async () => ({ rows: rowsOf(), rejections: [] }) } })
    const hooks = pod.hooks?.(ctx)
    await hooks?.beforeTurn?.[0]?.run({ threadId: toThreadId('t1'), projectDirectory: '/repo' })
    return pod.tools?.(ctx) ?? []
  }

  it('names tools mcp__<server>__<tool> and carries the server schema', async () => {
    const tools = await boot({ docs: { tools: [searchTool] } })
    const [tool] = tools
    expect(tool?.name).toBe('mcp__docs__search')
    expect(tool?.description).toBe('Find documentation')
    expect((tool as McpBridgeTool).jsonSchema).toEqual({ type: 'object' })
    expect(tool?.effect).toBe(EToolEffect.Read)
    expect(tool?.isConcurrencySafe?.({})).toBe(true)
  })

  it('maps the effect from the annotations and defaults to Write', async () => {
    const tools = await boot({
      docs: {
        tools: [
          { name: 'search', annotations: { readOnlyHint: true } },
          { name: 'drop', annotations: { destructiveHint: true } },
          { name: 'write' },
        ],
      },
    })
    const effects = Object.fromEntries(
      tools
        .filter((tool) => tool.name.startsWith('mcp__docs__'))
        .map((tool) => [tool.name, tool.effect]),
    )
    expect(effects).toEqual({
      mcp__docs__search: EToolEffect.Read,
      mcp__docs__drop: EToolEffect.Destructive,
      mcp__docs__write: EToolEffect.Write,
    })
  })

  it('round-trips a tools/call and renders structuredContent', async () => {
    const tools = await boot({
      docs: {
        tools: [searchTool],
        answer: () => ({ structuredContent: { hits: 2 }, content: [{ type: 'text', text: 'x' }] }),
      },
    })
    const outcome = await tools[0]?.invoke(invocation({ query: 'hooks' }))
    expect(outcome?.ok).toBe(true)
    if (outcome?.ok === true) expect(outcome.modelText).toContain('hits')
  })

  it('answers a call to a server that is not connected', async () => {
    const tool = new McpBridgeTool({
      server: 'gone',
      info: { name: 'search' },
      caller: () => undefined,
    })
    expect(await tool.invoke(invocation({}))).toEqual({
      ok: false,
      reason: "the 'gone' MCP server is not connected",
    })
  })
})

describe('session context', () => {
  it('asks the config port for the session it holds and skips repo files without a directory', async () => {
    const daemon = fakeDaemon({ docs: { tools: [] } })
    const asked: string[] = []
    const store = new McpStore({
      ctx: { ...rig(daemon), sessionId: 'ses_9', workspaceDirectory: null },
      config: {
        read: async (session) => {
          asked.push(session.sessionId)
          return { rows: rowsOf(), rejections: [] }
        },
      },
      connectTimeoutMs: 200,
      reconcileBudgetMs: 200,
    })
    await store.boot()
    expect(asked).toEqual(['ses_9'])
    expect(store.servers().map((server) => server.name)).toEqual(['docs'])
  })

  it('carries a cloud rejection beside the servers that did load', async () => {
    const daemon = fakeDaemon({ docs: { tools: [] } })
    const store = new McpStore({
      ctx: rig(daemon),
      config: {
        read: async () => ({
          rows: rowsOf(),
          rejections: [
            {
              rejection: EMcpRejection.Unreadable,
              name: 'sealed',
              definedIn: 'the cloud',
              origin: EDefinitionOrigin.User,
              detail: 'malformed encrypted secret blob (expected iv.tag.ciphertext)',
            },
          ],
        }),
      },
      connectTimeoutMs: 200,
      reconcileBudgetMs: 200,
    })
    await store.boot()
    expect(store.servers().map((server) => server.name)).toEqual(['docs'])
    expect(store.rejectionsOf().map((rejection) => rejection.name)).toEqual(['sealed'])
    expect(store.rows().map((row) => [row.name, row.status, row.reason])).toEqual([
      ['docs', EMcpViewStatus.Connected, undefined],
      [
        'sealed',
        EMcpViewStatus.Failed,
        'malformed encrypted secret blob (expected iv.tag.ciphertext)',
      ],
    ])
  })
})
