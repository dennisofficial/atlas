import { describe, expect, it } from 'bun:test'

import { DEFERRED_TOOLS_SOURCE, type Assembled } from '@dltech/atlas-core'

import { McpBridgeTool } from '../bridge-tool'
import { mcpDeferredListingHook } from '../deferred-listing'

const assembled: Assembled = { system: [], messages: [] }

const store = {
  toolNamesByServer: () =>
    new Map([
      ['docs', ['mcp__docs__search']],
      ['events', ['mcp__events__list', 'mcp__events__drop']],
    ]),
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
    const next = await mcpDeferredListingHook({ store }).run({ assembled, trace: [] })

    expect(next.system).toHaveLength(1)
    expect(next.system[0]?.source).toBe(DEFERRED_TOOLS_SOURCE)
    const text = next.system[0]?.text
    expect(text).toContain("Call tool_search to get a tool's schema, then call_tool to run it.")
    expect(text).toContain('docs: mcp__docs__search')
    expect(text).toContain('events: mcp__events__list, mcp__events__drop')
  })

  it('adds nothing when no MCP server has tools', async () => {
    const empty = { toolNamesByServer: () => new Map<string, readonly string[]>() }

    expect(await mcpDeferredListingHook({ store: empty }).run({ assembled, trace: [] })).toBe(
      assembled,
    )
  })
})
