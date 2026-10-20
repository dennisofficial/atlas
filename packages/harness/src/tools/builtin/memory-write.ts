import { EToolEffect, SchemaTool, TAKES_NO_PATHS, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'
import {
  EMemoryScope,
  EMemoryType,
  MAX_MEMORY_BODY_CHARS,
  MAX_MEMORY_DESCRIPTION_CHARS,
  MEMORY_NAME_PATTERN,
} from '@dltech/atlas-wire'
import { z } from 'zod'

import type { MemoryPort } from '../../memory/memory-port'

import { memoryRefusal, scopeLabelOf } from './memory-outcome'

const inputSchema = z.strictObject({
  scope: z.enum(EMemoryScope),
  name: z.string().regex(MEMORY_NAME_PATTERN),
  description: z.string().min(1).max(MAX_MEMORY_DESCRIPTION_CHARS),
  type: z.enum(EMemoryType),
  body: z.string().min(1).max(MAX_MEMORY_BODY_CHARS),
})

const description = [
  'Save a memory, or replace the one that already has this name in this scope.',
  'The name is lowercase words joined by hyphens and states the claim, like bun-deflate-is-raw-not-zlib.',
  `The description is one line of at most ${MAX_MEMORY_DESCRIPTION_CHARS} characters and is what the index shows.`,
  'The type is user, feedback, project or reference.',
  `The body states the fact first, then Why and How to apply, in at most ${MAX_MEMORY_BODY_CHARS} characters.`,
  'To change part of a memory, use edit_memory instead.',
].join(' ')

export class WriteMemoryTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'write_memory'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly port: MemoryPort) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const saved = await this.port.write(input)
      return {
        ok: true,
        output: { scope: input.scope, name: saved.name, revision: saved.revision, created: saved.revision === 1 },
        modelText: `Remembered ${saved.name} (${scopeLabelOf(saved.scope)}, revision ${saved.revision}).`,
      }
    } catch (error) {
      return memoryRefusal(error)
    }
  }
}
