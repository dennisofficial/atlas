import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

export type InstructionTurn = {
  root: Promise<string> | null
  personal: Promise<string | null> | null
  files: Map<string, Promise<string | null>>
}

export type InstructionsPodState = {
  threadId: string | null
  directory: string | null
  offered: Map<string, Map<string, string>>
  turn: InstructionTurn | null
}

const states = new WeakMap<PluginPodContext, InstructionsPodState>()

export const stateFor = (ctx: PluginPodContext): InstructionsPodState => {
  const kept = states.get(ctx)
  if (kept !== undefined) return kept
  const state: InstructionsPodState = {
    threadId: null,
    directory: null,
    offered: new Map(),
    turn: null,
  }
  states.set(ctx, state)
  return state
}
