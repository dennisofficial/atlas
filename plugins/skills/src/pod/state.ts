import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { SkillCatalogue } from './catalogue'

export type SkillsWatch = {
  directory: string
  watchId: string
  off(): void
  pending: Promise<void>
}

export type SkillsPodState = {
  directory: string | null
  catalogue: SkillCatalogue | null
  loading: { directory: string; promise: Promise<SkillCatalogue | null> } | null
  watch: SkillsWatch | null
}

const states = new WeakMap<PluginPodContext, SkillsPodState>()

export const forgetCatalogue = (state: SkillsPodState): void => {
  state.catalogue = null
}

export const stateFor = (ctx: PluginPodContext): SkillsPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: SkillsPodState = { directory: null, catalogue: null, loading: null, watch: null }
  states.set(ctx, state)
  return state
}
