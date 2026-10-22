import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { EMemoryScope, MAX_MEMORY_BODY_CHARS, MEMORY_NAME_PATTERN } from '@dltech/atlas-wire'
import { z } from 'zod'

import type { MemoryPort } from '../../memory/memory-port'

import { memoryRefusal, scopeLabelOf } from './memory-outcome'

const inputSchema = z.strictObject({
  scope: z.enum(EMemoryScope),
  name: z.string().regex(MEMORY_NAME_PATTERN),
  old: z.string().min(1).max(MAX_MEMORY_BODY_CHARS),
  new: z.string().max(MAX_MEMORY_BODY_CHARS),
  revision: z.number().int().min(1),
})

const description = [
  'Replace one passage of a memory body.',
  'old must occur exactly once in the body, and new replaces it.',
  'revision is the revision you got from read_memory; the edit is refused if the memory changed since, in which case read it again.',
].join(' ')

export class EditMemoryTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'edit_memory'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly port: MemoryPort) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const saved = await this.port.edit(input)
      return {
        ok: true,
        output: { scope: input.scope, name: saved.name, revision: saved.revision },
        modelText: `Edited ${saved.name} (${scopeLabelOf(saved.scope)}, revision ${saved.revision}).`,
      }
    } catch (error) {
      return memoryRefusal(error)
    }
  }
}
