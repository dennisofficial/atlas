import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeStep, type BeforeTurn } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { repoAgentListingOf } from './listing'
import { discoverRepoAgentTypes } from './repo-agent-types'
import type { CrewPodState } from './state'

type Ctx = Pick<PluginPodContext, 'call'>

const ORDER = { stage: EStage.Observe, nudge: 0 }

export const repoAgentTypesHook = (args: {
  ctx: Ctx
  state: CrewPodState
}): RegisteredHook<BeforeTurn> => ({
  name: 'crew-repo-agent-types',
  order: ORDER,
  awaited: true,
  run: async ({ projectDirectory }) => {
    args.state.directory = projectDirectory
    const found = await discoverRepoAgentTypes({ ctx: args.ctx, projectDirectory })
    args.state.types = found.types
    args.state.refusals = found.refusals
    return {}
  },
})

export const repoAgentListingHook = (args: {
  state: CrewPodState
}): RegisteredHook<BeforeStep> => ({
  name: 'crew-repo-agent-listing',
  order: ORDER,
  awaited: true,
  run: async ({ assembled }) => {
    if (args.state.directory === null) return assembled
    const listing = repoAgentListingOf({
      types: args.state.types,
      refusals: args.state.refusals,
    })
    if (listing === '') return assembled
    return { ...assembled, system: [...assembled.system, { text: listing, source: 'repo-agents' }] }
  },
})
