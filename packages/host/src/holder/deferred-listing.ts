import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  DEFERRED_TOOLS_SOURCE,
  EStage,
  TOOL_SEARCH_NAME,
  serverListingTextOf,
  toolNamesByServerOf,
  type BeforeStep,
  type ToolDeclaration,
} from '@dltech/atlas-core'

const LISTING_INTRO = [
  'These tools are available but not loaded.',
  `To get the input schema of a tool, call ${TOOL_SEARCH_NAME}.`,
  'Then call the tool directly by its name.',
].join(' ')

export const deferredListingHook = (args: {
  declarations: () => readonly ToolDeclaration[]
}): RegisteredHook<BeforeStep> => ({
  name: 'deferred-listing',
  awaited: true,
  order: { stage: EStage.Observe, nudge: 30 },
  run: async ({ assembled }) => {
    const groups = toolNamesByServerOf(args.declarations())
    if (groups.size === 0) return assembled
    const text = [LISTING_INTRO, serverListingTextOf(groups)].join('\n\n')
    return { ...assembled, system: [...assembled.system, { text, source: DEFERRED_TOOLS_SOURCE }] }
  },
})
