import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { EMemoryScope, EMemoryType } from '@dltech/atlas-core'

import { addressOf, kindOf } from './address'
import { memoryRefusal, scopeLabelOf } from './outcome'

export type MemoryWriteInput = {
  scope: EMemoryScope
  name: string
  description: string
  type: EMemoryType
  body: string
}

export const writeMemory = async (args: {
  ctx: PluginPodContext
  input: MemoryWriteInput
}): Promise<ToolOutcome> => {
  try {
    const saved = await args.ctx.control.memory.write({
      ...addressOf(args.input),
      description: args.input.description,
      type: kindOf(args.input.type),
      body: args.input.body,
    })
    return {
      ok: true,
      output: {
        scope: args.input.scope,
        name: saved.name,
        revision: saved.revision,
        created: saved.revision === 1,
      },
      modelText: `Remembered ${saved.name} (${scopeLabelOf(saved.scope)}, revision ${saved.revision}).`,
    }
  } catch (error) {
    return memoryRefusal(error)
  }
}
