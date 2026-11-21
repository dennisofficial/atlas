import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { addressOf } from './address'
import { addressLabelOf, memoryRefusal, scopeLabelOf } from './outcome'
import { reconcileNoticeAfterChange } from './reconcile'

import type { MemoryAddressInput } from './read'

export const deleteMemory = async (args: {
  ctx: PluginPodContext
  input: MemoryAddressInput
}): Promise<ToolOutcome> => {
  try {
    const deleted = await args.ctx.control.memory.delete(addressOf(args.input))
    if (!deleted)
      return { ok: false, reason: `there is no ${addressLabelOf(addressOf(args.input))}` }
    await reconcileNoticeAfterChange({ ctx: args.ctx, mayFire: false })
    return {
      ok: true,
      output: { scope: args.input.scope, name: args.input.name },
      modelText: `Forgot ${args.input.name} (${scopeLabelOf(args.input.scope)}).`,
    }
  } catch (error) {
    return memoryRefusal(error)
  }
}
