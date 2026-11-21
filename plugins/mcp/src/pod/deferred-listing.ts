import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  DEFERRED_TOOLS_SOURCE,
  EStage,
  serverListingTextOf,
  type BeforeStep,
} from '@dltech/atlas-core'

import { bridgeNameOf } from './bridge-tool'
import { connectedServersOf } from './resources'
import type { McpToolsSnapshot } from './snapshot'

const LISTING_INTRO =
  "These tools are available but not loaded. Call tool_search to get a tool's schema, then call_tool to run it."

export const toolNamesOf = (
  snapshot: McpToolsSnapshot | undefined,
): Map<string, readonly string[]> => {
  const groups = new Map<string, readonly string[]>()
  for (const server of connectedServersOf(snapshot)) {
    groups.set(
      server.name,
      server.tools.map((info) => bridgeNameOf(server.name, info.name)),
    )
  }
  return groups
}

export const mcpDeferredListingHook = (args: {
  snapshot(): McpToolsSnapshot | undefined
}): RegisteredHook<BeforeStep> => ({
  name: 'mcp-deferred-tools',
  order: { stage: EStage.Observe, nudge: 30 },
  run: async ({ assembled }) => {
    const groups = toolNamesOf(args.snapshot())
    if (groups.size === 0) return assembled
    const text = [LISTING_INTRO, serverListingTextOf(groups)].join('\n\n')
    return { ...assembled, system: [...assembled.system, { text, source: DEFERRED_TOOLS_SOURCE }] }
  },
})
