import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { addressOf } from './address'
import { addressLabelOf, memoryRefusal, scopeLabelOf } from './outcome'
import { reconcileNoticeAfterChange } from './reconcile'
import { markStale, type MemoryPodState } from './state'

import type { MemoryAddressInput } from './read'

export const deleteMemory = async (args: {
  ctx: PluginPodContext
  state: MemoryPodState
  input: MemoryAddressInput
}): Promise<ToolOutcome> => {
  try {
    const deleted = await args.ctx.control.memory.delete(addressOf(args.input))
    if (!deleted)
      return { ok: false, reason: `there is no ${addressLabelOf(addressOf(args.input))}` }
    markStale(args.state)
    await reconcileNoticeAfterChange({ ctx: args.ctx, state: args.state, mayFire: false })
    return {
      ok: true,
      output: { scope: args.input.scope, name: args.input.name },
      modelText: `Forgot ${args.input.name} (${scopeLabelOf(args.input.scope)}).`,
    }
  } catch (error) {
    return memoryRefusal(error)
  }
}
