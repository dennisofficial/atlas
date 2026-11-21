import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeStep } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { repoAgentListingOf } from './listing'
import { repoAgentTypesOf } from './resource'

type Ctx = Pick<PluginPodContext, 'events'>

const ORDER = { stage: EStage.Observe, nudge: 0 }

export const repoAgentListingHook = (args: { ctx: Ctx }): RegisteredHook<BeforeStep> => ({
  name: 'crew-repo-agent-listing',
  order: ORDER,
  run: async ({ assembled }) => {
    const found = repoAgentTypesOf(args.ctx)
    if (found === undefined) return assembled
    const listing = repoAgentListingOf(found)
    if (listing === '') return assembled
    return { ...assembled, system: [...assembled.system, { text: listing, source: 'repo-agents' }] }
  },
})
