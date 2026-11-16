import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { RepoAgentRefusal, RepoAgentType } from '../core'

export type CrewPodState = {
  directory: string | null
  types: readonly RepoAgentType[]
  refusals: readonly RepoAgentRefusal[]
}

const states = new WeakMap<PluginPodContext, CrewPodState>()

export const stateFor = (ctx: PluginPodContext): CrewPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: CrewPodState = { directory: null, types: [], refusals: [] }
  states.set(ctx, state)
  return state
}
