import { EDefinitionOrigin, EToolEffect } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { mcpCommand, type McpCloudRow } from '../../core'
import { EMcpRejection, EMcpViewStatus } from '../../core'
import { mcpPod } from '..'
import { McpBridgeTool } from '../bridge-tool'
import { mcpConfigResource } from '../resources'
import { rowsOf } from '../roster'
import { EMcpServerStatus } from '../snapshot'
import { fakeDaemon, loadConfig, loadTools, recordingRig, snapshotEventOf } from './support'
import { MCP_TOOLS } from '../resources'

const docsTransport = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const searchTool = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
}

const rowsOfCloud = (): readonly McpCloudRow[] => [
  { source: 'user', spec: { name: 'docs', transport: docsTransport } },
]

describe('config through the pod', () => {
  it('lets a repo file override a cloud row', async () => {
    const daemon = fakeDaemon()
    daemon.files.set(
      '/repo/.atlas/mcp.json',
      JSON.stringify({
        mcpServers: { docs: { transport: { kind: 'stdio', command: 'repo-server' } } },
      }),
    )
    await loadTools({ daemon, rows: rowsOfCloud() })

    expect(daemon.spawns[0]?.command).toBe('repo-server')
  })

  it('lets a repo disabled stub hide the cloud row it names', async () => {
    const daemon = fakeDaemon()
    daemon.files.set(
      '/repo/.atlas/mcp.json',
      JSON.stringify({ mcpServers: { docs: { disabled: true } } }),
    )
    const { snapshot } = await loadConfig({ daemon, rows: rowsOfCloud() })

    expect(snapshot.servers).toEqual([])
  })

  it("reads Claude's .mcp.json when no native definition names the server", async () => {
    const daemon = fakeDaemon()
    daemon.files.set('/repo/.mcp.json', JSON.stringify({ docs: { command: 'compat-server' } }))
    await loadTools({ daemon, rows: [] })

    expect(daemon.spawns[0]?.command).toBe('compat-server')
  })

  it('turns an entry that fails to parse into a rejection carrying the parse detail', async () => {
    const daemon = fakeDaemon()
    daemon.files.set('/repo/.atlas/mcp.json', JSON.stringify({ mcpServers: { docs: {} } }))
    const { snapshot } = await loadConfig({ daemon, rows: [] })

    expect(snapshot.rejections[0]?.name).toBe('docs')
    expect(snapshot.rejections[0]?.detail).toContain('transport')
  })

  it('carries a cloud rejection beside the servers that did load', async () => {
    const daemon = fakeDaemon()
    const resource = mcpConfigResource({
      config: {
        read: async () => ({
          rows: rowsOfCloud(),
          rejections: [
            {
              rejection: EMcpRejection.Unreadable,
              name: 'sealed',
              definedIn: 'the cloud',
              origin: EDefinitionOrigin.User,
              detail: 'malformed encrypted secret blob',
            },
          ],
        }),
      },
    })
    const { ctx } = recordingRig(daemon)
    const snapshot = await resource.load({ ctx, directory: '/repo' })

    expect(snapshot.servers.map((server) => server.name)).toEqual(['docs'])
    expect(snapshot.rejections.map((rejection) => rejection.name)).toEqual(['sealed'])
  })
})

describe('bridge tools from a recorded snapshot', () => {
  const boot = async (
    tools: readonly {
      name: string
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
    }[],
  ) => {
    const daemon = fakeDaemon({ 's1.docs': { tools } })
    const record = {
      configHash: 'h',
      directory: '/repo',
      servers: [
        {
          name: 'docs',
          origin: EDefinitionOrigin.User,
          transportKind: 'stdio' as const,
          configHash: 'c1',
          status: EMcpServerStatus.Connected,
          tools: tools.length > 0 ? [searchTool] : [],
        },
      ],
    }
    const { ctx } = recordingRig(daemon, {
      records: [snapshotEventOf({ resource: MCP_TOOLS, value: record })],
    })
    const pod = mcpPod({ config: { read: async () => ({ rows: [], rejections: [] }) } })
    return { tools: pod.tools?.(ctx) ?? [], daemon }
  }

  it('names tools mcp__<server>__<tool> and carries the server schema', async () => {
    const { tools } = await boot([searchTool])
    const tool = tools.find((candidate) => candidate.name === 'mcp__docs__search')

    expect(tool?.description).toBe('Find documentation')
    expect((tool as McpBridgeTool).jsonSchema).toEqual({ type: 'object' })
    expect(tool?.effect).toBe(EToolEffect.Read)
    expect(tool?.isConcurrencySafe?.({})).toBe(true)
  })

  it('maps the effect from the annotations', () => {
    expect(
      new McpBridgeTool({
        server: 'docs',
        info: { name: 'drop', annotations: { destructiveHint: true } },
        caller: () => undefined,
      }).effect,
    ).toBe(EToolEffect.Destructive)
    expect(
      new McpBridgeTool({ server: 'docs', info: { name: 'write' }, caller: () => undefined })
        .effect,
    ).toBe(EToolEffect.Write)
  })

  it('answers a call to a server that is not connected', async () => {
    const tool = new McpBridgeTool({
      server: 'gone',
      info: { name: 'search' },
      caller: () => undefined,
    })
    expect(
      await tool.invoke({
        input: {},
        signal: new AbortController().signal,
        idempotencyKey: 'k',
        projectDirectory: '/repo',
        threadId: 't1' as never,
      }),
    ).toEqual({ ok: false, reason: "the 'gone' MCP server is not connected" })
  })
})

describe('the mcp report command', () => {
  it('renders the rows the session recorded, without asking the pod', async () => {
    const pod = mcpPod({ config: { read: async () => ({ rows: [], rejections: [] }) } })
    const report = pod.commands.get(mcpCommand.inboxKind)
    const appended: unknown[] = []
    const result = await report?.({
      args: undefined,
      sessionId: 's1',
      inboxId: 1,
      visibleEvents: () =>
        [snapshotEventOf({ resource: 'mcp-server-changed', value: null }) as never].flatMap(() => [
          {
            type: 'mcp-server-changed',
            row: {
              name: 'docs',
              transport: 'stdio',
              status: EMcpViewStatus.Connected,
              toolCount: 1,
              layer: EDefinitionOrigin.User,
            },
          } as never,
        ]),
      append: async (drafts) => void appended.push(...drafts),
      log: () => undefined,
    })

    expect(result).toEqual({ kind: 'done' })
    expect(JSON.stringify(appended)).toContain('docs Connected 1 tool user')
  })
})

describe('rowsOf', () => {
  it('renders a failed server beside the rejections it kept', () => {
    const rows = rowsOf({
      configHash: 'h',
      directory: '/repo',
      servers: [
        {
          name: 'docs',
          origin: EDefinitionOrigin.User,
          transportKind: 'stdio',
          configHash: 'c',
          status: EMcpServerStatus.Failed,
          reason: 'boom',
          tools: [],
        },
      ],
    })
    expect(rows[0]).toMatchObject({ name: 'docs', status: EMcpViewStatus.Failed, reason: 'boom' })
  })
})
