import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { EMemoryScope } from '@dltech/atlas-core'

import { addressOf } from './address'
import { memoryRefusal, scopeLabelOf } from './outcome'

export type MemoryEditInput = {
  scope: EMemoryScope
  name: string
  old: string
  new: string
  revision: number
}

export const editMemory = async (args: {
  ctx: PluginPodContext
  input: MemoryEditInput
}): Promise<ToolOutcome> => {
  try {
    const saved = await args.ctx.control.memory.edit({
      ...addressOf(args.input),
      old: args.input.old,
      new: args.input.new,
      revision: args.input.revision,
    })
    return {
      ok: true,
      output: { scope: args.input.scope, name: saved.name, revision: saved.revision },
      modelText: `Edited ${saved.name} (${scopeLabelOf(saved.scope)}, revision ${saved.revision}).`,
    }
  } catch (error) {
    return memoryRefusal(error)
  }
}
