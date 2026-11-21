import { EDefinitionOrigin, EToolEffect } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { MCP_TOOLS, loadConfig, loadTools } from './support'
import type { McpCloudRow } from '../../core'
import { mcpPod } from '..'
import { McpBridgeTool } from '../bridge-tool'
import { mcpToolsResource } from '../resources'
import { McpSignInBook } from '../sign-in-book'
import { EMcpServerStatus } from '../snapshot'
import { fakeDaemon, fakeProxyControl, invocation, recordingRig, snapshotEventOf } from './support'
import { eventOf } from './recording'

const searchTool = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
}

const stdio = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const rowsOf = (
  over: Partial<McpCloudRow['spec']> = {},
  accessToken?: string,
): readonly McpCloudRow[] => [
  {
    source: 'user',
    spec: { name: 'docs', transport: stdio, ...over },
    ...(accessToken === undefined ? {} : { accessToken }),
  },
]

describe('the recorded mcp-config snapshot', () => {
  it('never carries an access token, an env value or a header value', async () => {
    const daemon = fakeDaemon()
    const { snapshot } = await loadConfig({
      daemon,
      rows: [{ source: 'user', spec: { name: 'docs', transport: stdio }, accessToken: 'token-1' }],
    })
    daemon.files.set(
      '/repo/.mcp.json',
      JSON.stringify({
        gh: {
          type: 'http',
          url: 'https://mcp.test/mcp',
          headers: { authorization: 'Bearer from-file' },
        },
      }),
    )
    const withFile = await loadConfig({
      daemon,
      rows: [
        {
          source: 'user',
          spec: {
            name: 'paper',
            transport: { kind: 'stdio', command: 'paper', env: { PAPER_KEY: 'env-secret' } },
          },
        },
      ],
    })

    const text = [JSON.stringify(snapshot), JSON.stringify(withFile.snapshot)].join('')
    expect(text).not.toContain('token-1')
    expect(text).not.toContain('env-secret')
    expect(text).not.toContain('Bearer from-file')
    expect(snapshot.servers[0]?.configHash).toHaveLength(8)
  })

  it('names the file, its origin and its transport for every configured server', async () => {
    const daemon = fakeDaemon()
    daemon.files.set(
      '/repo/.atlas/mcp.json',
      JSON.stringify({ mcpServers: { local: { transport: { kind: 'stdio', command: 'local' } } } }),
    )
    const { snapshot } = await loadConfig({ daemon, rows: rowsOf() })

    expect(snapshot.servers.map((server) => [server.name, server.definedIn])).toEqual([
      ['docs', 'the cloud'],
      ['local', '.atlas/mcp.json'],
    ])
    expect(snapshot.rejections).toEqual([])
  })
})

describe('the recorded mcp-tools snapshot', () => {
  it('connects a stdio server, records its tools and leaves the process running', async () => {
    const daemon = fakeDaemon({ 's1.docs': { tools: [searchTool], instructions: 'Docs first.' } })
    const { snapshot } = await loadTools({ daemon, rows: rowsOf() })

    expect(snapshot.servers[0]).toMatchObject({
      name: 'docs',
      status: EMcpServerStatus.Connected,
      instructions: 'Docs first.',
    })
    expect(snapshot.servers[0]?.tools.map((tool) => tool.name)).toEqual(['search'])
    expect(daemon.spawns.map((spawn) => spawn.serverId)).toEqual(['s1.docs'])
    expect(daemon.closed).toEqual([])
  })

  it('records a failed server with the first lines of its stderr', async () => {
    const daemon = fakeDaemon({
      's1.docs': { exit: { exitCode: 1, signal: null }, stderr: ['Error: missing token'] },
    })
    const { snapshot } = await loadTools({ daemon, rows: rowsOf() })

    expect(snapshot.servers[0]?.status).toBe(EMcpServerStatus.Failed)
    expect(snapshot.servers[0]?.reason).toContain('Error: missing token')
    expect(snapshot.servers[0]?.tools).toEqual([])
  })

  it('marks a proxied server unavailable while the Mac is closed, and spawns nothing', async () => {
    const proxy = fakeProxyControl({ online: false })
    const daemon = fakeDaemon()
    const { snapshot } = await loadTools({
      daemon,
      rows: rowsOf({ proxy: true }),
      mcp: proxy.control,
    })

    expect(snapshot.servers[0]).toMatchObject({
      status: EMcpServerStatus.Unavailable,
      reason: 'Mac app offline',
    })
    expect(daemon.spawns).toEqual([])
  })
})

describe('a fresh context with a recorded snapshot', () => {
  const recorded = {
    configHash: 'h',
    directory: '/repo',
    servers: [
      {
        name: 'docs',
        origin: EDefinitionOrigin.User as const,
        transportKind: 'stdio' as const,
        configHash: 'c1',
        status: EMcpServerStatus.Connected as const,
        tools: [searchTool],
      },
    ],
  }

  const boot = (daemon: ReturnType<typeof fakeDaemon>) => {
    const recording = recordingRig(daemon, {
      records: [snapshotEventOf({ resource: MCP_TOOLS, value: recorded })],
    })
    const pod = mcpPod({ config: { read: async () => ({ rows: rowsOf(), rejections: [] }) } })
    return { ...recording, tools: pod.tools?.(recording.ctx) ?? [] }
  }

  it('lists the bridge tools with no daemon call at all', () => {
    const daemon = fakeDaemon({ 's1.docs': { tools: [searchTool] } })
    const { tools } = boot(daemon)

    expect(tools.map((tool) => tool.name)).toContain('mcp__docs__search')
    expect(daemon.spawns).toEqual([])
    expect(daemon.reads()).toBe(0)
  })

  it('attaches and calls on the first invoke', async () => {
    const daemon = fakeDaemon({
      's1.docs': {
        tools: [searchTool],
        answer: () => ({ content: [{ type: 'text', text: 'hit' }] }),
      },
    })
    const { tools } = boot(daemon)
    const tool = tools.find((candidate) => candidate.name === 'mcp__docs__search') as McpBridgeTool

    const outcome = await tool?.invoke(invocation({ query: 'hooks' }))

    expect(outcome?.ok).toBe(true)
    expect(daemon.spawns.map((spawn) => spawn.serverId)).toEqual(['s1.docs'])
    expect(tool?.effect).toBe(EToolEffect.Read)
  })
})

describe('the tools resource announcement', () => {
  it('emits the roster and the instructions once per change', async () => {
    const resource = mcpToolsResource({
      config: { read: async () => ({ rows: rowsOf(), rejections: [] }) },
      connectTimeoutMs: 200,
      signIns: new McpSignInBook(),
    })
    const daemon = fakeDaemon({ 's1.docs': { tools: [searchTool], instructions: 'Docs first.' } })
    const value = {
      configHash: 'h',
      directory: '/repo',
      servers: [
        {
          name: 'docs',
          origin: EDefinitionOrigin.User as const,
          transportKind: 'stdio' as const,
          configHash: 'c1',
          status: EMcpServerStatus.Connected as const,
          tools: [searchTool],
          instructions: 'Docs first.',
        },
      ],
    }

    const first = recordingRig(daemon)
    const announced = resource.announce?.(value, first.ctx) ?? []
    expect(announced).toHaveLength(2)

    const second = recordingRig(daemon, {
      records: [
        snapshotEventOf({ resource: MCP_TOOLS, value }),
        ...announced.map((draft, index) => eventOf(draft, index + 2)),
      ],
    })
    expect(resource.announce?.(value, second.ctx)).toEqual([])
  })
})
