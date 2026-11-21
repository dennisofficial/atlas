import { DEFERRED_TOOLS_SOURCE, EDefinitionOrigin, type Assembled } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { McpBridgeTool } from '../bridge-tool'
import { mcpDeferredListingHook } from '../deferred-listing'
import { toolNamesOf } from '../deferred-listing'
import { EMcpServerStatus, type McpToolsSnapshot } from '../snapshot'

const assembled: Assembled = { system: [], messages: [] }

const snapshot: McpToolsSnapshot = {
  configHash: 'h',
  directory: '/repo',
  servers: [
    {
      name: 'docs',
      origin: EDefinitionOrigin.User,
      transportKind: 'stdio',
      configHash: 'a',
      status: EMcpServerStatus.Connected,
      tools: [{ name: 'search' }],
    },
    {
      name: 'events',
      origin: EDefinitionOrigin.User,
      transportKind: 'http',
      configHash: 'b',
      status: EMcpServerStatus.Connected,
      tools: [{ name: 'list' }, { name: 'drop' }],
    },
    {
      name: 'gone',
      origin: EDefinitionOrigin.User,
      transportKind: 'http',
      configHash: 'c',
      status: EMcpServerStatus.Failed,
      tools: [{ name: 'hidden' }],
    },
  ],
}

describe('a bridge tool', () => {
  it('is always deferred', () => {
    const tool = new McpBridgeTool({
      server: 'docs',
      info: { name: 'search' },
      caller: () => undefined,
    })

    expect(tool.deferred).toBe(true)
  })
})

describe('the deferred listing hook', () => {
  it('appends one system block saying how to run them, then the names by server', async () => {
    const next = await mcpDeferredListingHook({ snapshot: () => snapshot }).run({
      assembled,
      trace: [],
    })

    expect(next.system).toHaveLength(1)
    expect(next.system[0]?.source).toBe(DEFERRED_TOOLS_SOURCE)
    const text = next.system[0]?.text
    expect(text).toContain("Call tool_search to get a tool's schema, then call_tool to run it.")
    expect(text).toContain('docs: mcp__docs__search')
    expect(text).toContain('events: mcp__events__list, mcp__events__drop')
  })

  it('lists nothing for a server that is not connected', () => {
    expect([...toolNamesOf(snapshot).keys()]).toEqual(['docs', 'events'])
  })

  it('adds nothing when no MCP server has tools', async () => {
    const empty = { snapshot: () => undefined }

    expect(await mcpDeferredListingHook(empty).run({ assembled, trace: [] })).toBe(assembled)
  })
})
