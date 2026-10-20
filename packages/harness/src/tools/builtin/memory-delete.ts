import { EToolEffect, SchemaTool, TAKES_NO_PATHS, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'
import { EMemoryScope, MEMORY_NAME_PATTERN } from '@dltech/atlas-wire'
import { z } from 'zod'

import type { MemoryPort } from '../../memory/memory-port'

import { addressLabelOf, memoryRefusal, scopeLabelOf } from './memory-outcome'

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

  constructor(private readonly port: MemoryPort) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const deleted = await this.port.delete(input)
      if (!deleted) return { ok: false, reason: `there is no ${addressLabelOf(input)}` }
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
