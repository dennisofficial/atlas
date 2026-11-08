import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ShellCursors } from './cursors'

export type ShellPodState = {
  cursors: ShellCursors
  awaiting: Set<string>
  endings: Set<string>
  inputs: Set<string>
  starting: Map<string, Promise<void>>
}

const states = new WeakMap<PluginPodContext, ShellPodState>()

export const stateFor = (ctx: PluginPodContext): ShellPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: ShellPodState = {
    cursors: new ShellCursors(),
    awaiting: new Set(),
    endings: new Set(),
    inputs: new Set(),
    starting: new Map(),
  }
  states.set(ctx, state)
  return state
}
