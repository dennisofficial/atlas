import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

export type ServicePodState = {
  readies: Set<string>
  endings: Set<string>
  stopping: Set<string>
  restarting: Set<string>
  cwds: Map<string, string>
  starting: Map<string, Promise<void>>
}

const states = new WeakMap<PluginPodContext, ServicePodState>()

export const stateFor = (ctx: PluginPodContext): ServicePodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: ServicePodState = {
    readies: new Set(),
    endings: new Set(),
    stopping: new Set(),
    restarting: new Set(),
    cwds: new Map(),
    starting: new Map(),
  }
  states.set(ctx, state)
  return state
}
