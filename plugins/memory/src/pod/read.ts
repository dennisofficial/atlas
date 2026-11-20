import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { EMemoryScope } from '@dltech/atlas-core'

import { addressOf } from './address'
import { addressLabelOf, memoryRefusal, scopeLabelOf } from './outcome'

export type MemoryAddressInput = { scope: EMemoryScope; name: string }

export const readMemory = async (args: {
  ctx: PluginPodContext
  input: MemoryAddressInput
}): Promise<ToolOutcome> => {
  try {
    const entry = await args.ctx.control.memory.read(addressOf(args.input))
    if (entry === null)
      return { ok: false, reason: `there is no ${addressLabelOf(addressOf(args.input))}` }
    return {
      ok: true,
      output: {
        scope: args.input.scope,
        name: entry.name,
        type: entry.type,
        revision: entry.revision,
        lines: entry.body.split('\n').length,
      },
      modelText: `${entry.name} (${scopeLabelOf(entry.scope)}, ${entry.type}, revision ${entry.revision})\n${entry.description}\n\n${entry.body}`,
    }
  } catch (error) {
    return memoryRefusal(error)
  }
}
