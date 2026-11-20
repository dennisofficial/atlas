import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  DEFERRED_TOOLS_SOURCE,
  EStage,
  serverListingTextOf,
  type BeforeStep,
} from '@dltech/atlas-core'

import type { McpStore } from './store'

const LISTING_INTRO =
  "These tools are available but not loaded. Call tool_search to get a tool's schema, then call_tool to run it."

export const mcpDeferredListingHook = (args: {
  store: Pick<McpStore, 'toolNamesByServer'>
}): RegisteredHook<BeforeStep> => ({
  name: 'mcp-deferred-tools',
  order: { stage: EStage.Observe, nudge: 30 },
  run: async ({ assembled }) => {
    const groups = args.store.toolNamesByServer()
    if (groups.size === 0) return assembled
    const text = [LISTING_INTRO, serverListingTextOf(groups)].join('\n\n')
    return { ...assembled, system: [...assembled.system, { text, source: DEFERRED_TOOLS_SOURCE }] }
  },
})
