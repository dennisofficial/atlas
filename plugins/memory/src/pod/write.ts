import { descriptionBudgetRefusal, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { EMemoryScope, EMemoryType } from '@dltech/atlas-core'

import { addressOf, kindOf } from './address'
import { memoryRefusal, scopeLabelOf } from './outcome'
import { reconcileNoticeAfterChange } from './reconcile'
import { markStale, type MemoryPodState } from './state'

export type MemoryWriteInput = {
  scope: EMemoryScope
  name: string
  description: string
  type: EMemoryType
  body: string
}

export const writeMemory = async (args: {
  ctx: PluginPodContext
  state: MemoryPodState
  input: MemoryWriteInput
}): Promise<ToolOutcome> => {
  const overBudget = descriptionBudgetRefusal(args.input.description)
  if (overBudget !== undefined) return { ok: false, reason: overBudget }
  try {
    const saved = await args.ctx.control.memory.write({
      ...addressOf(args.input),
      description: args.input.description,
      type: kindOf(args.input.type),
      body: args.input.body,
    })
    markStale(args.state)
    const notice = await reconcileNoticeAfterChange({
      ctx: args.ctx,
      state: args.state,
      mayFire: true,
    })
    const remembered = `Remembered ${saved.name} (${scopeLabelOf(saved.scope)}, revision ${saved.revision}).`
    return {
      ok: true,
      output: {
        scope: args.input.scope,
        name: saved.name,
        revision: saved.revision,
        created: saved.revision === 1,
        ...(notice === undefined ? {} : { reconcile: true }),
      },
      modelText: notice === undefined ? remembered : `${remembered}\n\n${notice}`,
    }
  } catch (error) {
    return memoryRefusal(error)
  }
}
