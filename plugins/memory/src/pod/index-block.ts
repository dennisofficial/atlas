import type { Assembled } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { memoryIndexOf, unavailableIndexOf } from '../core'
import type { MemoryPodState } from './state'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const withMemoryIndex = async (args: {
  assembled: Assembled
  ctx: Pick<PluginPodContext, 'control'>
  state: MemoryPodState
}): Promise<Assembled> => {
  const { state } = args
  const needsLoad = state.text === null || state.failed || state.stale
  if (needsLoad) {
    state.loading ??= load({ ctx: args.ctx, state }).finally(() => {
      state.loading = null
    })
    await state.loading
  }
  if (state.text === null) return args.assembled
  return { ...args.assembled, system: [...args.assembled.system, { text: state.text }] }
}

const load = async (args: {
  ctx: Pick<PluginPodContext, 'control'>
  state: MemoryPodState
}): Promise<void> => {
  try {
    const snapshot = await args.ctx.control.memory.list()
    args.state.text = memoryIndexOf(snapshot)
    args.state.failed = false
    args.state.stale = false
  } catch (error) {
    args.state.text = unavailableIndexOf(messageOf(error))
    args.state.failed = true
  }
}
