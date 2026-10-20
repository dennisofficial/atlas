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
  'Read the full body of one memory listed in the memory index.',
  'The scope is global or project, and the name is the one shown in the index.',
  'The result starts with the memory\'s revision, which edit_memory needs.',
].join(' ')

export class ReadMemoryTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'read_memory'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly port: MemoryPort) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const entry = await this.port.read(input)
      if (entry === null) return { ok: false, reason: `there is no ${addressLabelOf(input)}` }
      return {
        ok: true,
        output: { scope: input.scope, name: entry.name, type: entry.type, revision: entry.revision, lines: entry.body.split('\n').length },
        modelText: `${entry.name} (${scopeLabelOf(entry.scope)}, ${entry.type}, revision ${entry.revision})\n${entry.description}\n\n${entry.body}`,
      }
    } catch (error) {
      return memoryRefusal(error)
    }
  }
}
