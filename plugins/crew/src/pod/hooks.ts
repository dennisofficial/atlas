import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeStep, type BeforeTurn } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { repoAgentListingOf } from './listing'
import type { CrewPodState } from './state'
import { syncRepoAgentTypes } from './watch'

type Ctx = Pick<PluginPodContext, 'call' | 'log' | 'onDaemonEvent' | 'sessionId'>

const ORDER = { stage: EStage.Observe, nudge: 0 }

export const repoAgentTypesHook = (args: {
  ctx: Ctx
  state: CrewPodState
}): RegisteredHook<BeforeTurn> => ({
  name: 'crew-repo-agent-types',
  order: ORDER,
  run: async ({ projectDirectory }) => {
    await syncRepoAgentTypes({
      ctx: args.ctx,
      state: args.state,
      directory: projectDirectory,
    })
    return {}
  },
})

export const repoAgentListingHook = (args: {
  state: CrewPodState
}): RegisteredHook<BeforeStep> => ({
  name: 'crew-repo-agent-listing',
  order: ORDER,
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
