import { PodRuntimeScope, type PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { DaemonEventFrame } from '@dltech/atlas-protocol'

import { ShellCursors } from './cursors'
import { shellLiveOf } from './live-watch'

export type ShellPodState = {
  cursors: ShellCursors
  live: ReturnType<typeof shellLiveOf>
  awaiting: Set<string>
  endings: Set<string>
  inputs: Set<string>
  unclaimed: Map<string, DaemonEventFrame>
}

const states = new WeakMap<PluginPodContext, ShellPodState>()

export const stateFor = (ctx: PluginPodContext): ShellPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: ShellPodState = {
    cursors: new ShellCursors(),
    live: (ctx.runtime ?? new PodRuntimeScope(ctx)).shared(shellLiveOf),
    awaiting: new Set(),
    endings: new Set(),
    inputs: new Set(),
    unclaimed: new Map(),
  }
  states.set(ctx, state)
  return state
}
