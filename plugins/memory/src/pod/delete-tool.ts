import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { EMemoryScope, MEMORY_NAME_PATTERN } from '@dltech/atlas-wire'
import { z } from 'zod'

import { addressOf } from './address'
import { addressLabelOf, memoryRefusal, scopeLabelOf } from './outcome'
import { markStale, type MemoryPodState } from './state'

const inputSchema = z.strictObject({
  scope: z.enum(EMemoryScope),
  name: z.string().regex(MEMORY_NAME_PATTERN),
})

const description = [
  'Delete a memory that turned out wrong or that another memory now covers.',
  'The scope is global or project, and the name is the one shown in the index.',
].join(' ')

export class DeleteMemoryTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'delete_memory'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: MemoryPodState,
  ) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const deleted = await this.ctx.control.memory.delete(addressOf(input))
      if (!deleted) return { ok: false, reason: `there is no ${addressLabelOf(addressOf(input))}` }
      markStale(this.state)
      return {
        ok: true,
        output: { scope: input.scope, name: input.name },
        modelText: `Forgot ${input.name} (${scopeLabelOf(input.scope)}).`,
      }
    } catch (error) {
      return memoryRefusal(error)
    }
  }
}
