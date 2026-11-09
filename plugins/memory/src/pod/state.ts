import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

export type MemoryPodState = {
  text: string | null
  loading: Promise<void> | null
  failed: boolean
  stale: boolean
}

const states = new WeakMap<PluginPodContext, MemoryPodState>()

export const stateFor = (ctx: PluginPodContext): MemoryPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: MemoryPodState = { text: null, loading: null, failed: false, stale: false }
  states.set(ctx, state)
  return state
}

export const markStale = (state: MemoryPodState): void => {
  state.stale = true
}
