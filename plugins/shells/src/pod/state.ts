import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ShellCursors } from './cursors'
import { ShellLive } from './live-watch'

export type ShellPodState = {
  cursors: ShellCursors
  live: ShellLive
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
    live: new ShellLive(ctx),
    awaiting: new Set(),
    endings: new Set(),
    inputs: new Set(),
    starting: new Map(),
  }
  states.set(ctx, state)
  return state
}
