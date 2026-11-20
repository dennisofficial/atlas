import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { RepoAgentRefusal, RepoAgentType } from '../core'

export type CrewWatch = {
  directory: string
  watchId: string
  generation: number
  armed: boolean
  off(): void
  pending: Promise<void>
}

export type CrewPodState = {
  directory: string | null
  generation: number
  types: readonly RepoAgentType[]
  refusals: readonly RepoAgentRefusal[]
  watch: CrewWatch | null
}

const states = new WeakMap<PluginPodContext, CrewPodState>()

export const stateFor = (ctx: PluginPodContext): CrewPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: CrewPodState = {
    directory: null,
    generation: 0,
    types: [],
    refusals: [],
    watch: null,
  }
  states.set(ctx, state)
  return state
}
