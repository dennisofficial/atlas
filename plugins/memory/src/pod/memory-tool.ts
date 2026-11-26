import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import {
  EMemoryScope,
  EMemoryType,
  MAX_MEMORY_BODY_CHARS,
  MAX_MEMORY_DESCRIPTION_CHARS,
  MEMORY_INDEX_DESCRIPTION_CHARS,
  MEMORY_NAME_PATTERN,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { deleteMemory } from './delete'
import { editMemory } from './edit'
import { readMemory, type MemoryAddressInput } from './read'
import { writeMemory } from './write'

export enum EMemoryAction {
  Write = 'write',
  Read = 'read',
  Edit = 'edit',
  Delete = 'delete',
}

const baseSchema = z.strictObject({
  action: z.enum(EMemoryAction),
  scope: z.enum(EMemoryScope).optional(),
  name: z.string().regex(MEMORY_NAME_PATTERN).optional(),
  description: z.string().min(1).max(MAX_MEMORY_DESCRIPTION_CHARS).optional(),
  type: z.enum(EMemoryType).optional(),
  body: z.string().min(1).max(MAX_MEMORY_BODY_CHARS).optional(),
  old: z.string().min(1).max(MAX_MEMORY_BODY_CHARS).optional(),
  new: z.string().max(MAX_MEMORY_BODY_CHARS).optional(),
  revision: z.number().int().min(1).optional(),
})

type MemoryInput = z.output<typeof baseSchema>

const REQUIRED: Readonly<Record<EMemoryAction, readonly (keyof MemoryInput)[]>> = {
  [EMemoryAction.Write]: ['scope', 'name', 'description', 'type', 'body'],
  [EMemoryAction.Read]: ['scope', 'name'],
  [EMemoryAction.Edit]: ['scope', 'name', 'old', 'new', 'revision'],
  [EMemoryAction.Delete]: ['scope', 'name'],
}

const inputSchema = baseSchema.superRefine((input, context) => {
  for (const field of REQUIRED[input.action]) {
    if (input[field] !== undefined) continue
    context.addIssue({
      code: 'custom',
      path: [field],
      message: `action ${input.action} needs ${field}`,
    })
  }
})

const description = [
  'Memory is named entries stored in Atlas Cloud.',
  "scope is global, group or project. global covers every project and holds what stays true when the repository changes. group covers every project in the operator's project group and holds what holds across all of them. project covers this repository and every clone of it.",
  'name is lowercase words joined by hyphens, at most 100 characters, and states the claim, like bun-deflate-is-raw-not-zlib.',
  `action write needs scope, name, description, type and body. It saves a memory, or replaces the one with this name in this scope. type is user, feedback, project or reference. description is one line and one claim of at most ${MEMORY_INDEX_DESCRIPTION_CHARS} characters, which the index shows. body puts the fact first, then Why and How to apply, in at most ${MAX_MEMORY_BODY_CHARS} characters.`,
  'action read needs scope and name, and returns the body, the revision and the date of the last update.',
  'action edit needs scope, name, old, new and revision. old must occur exactly once. revision is the one read reported. An edit is refused when the memory changed since; read it again.',
  'action delete needs scope and name, and removes a memory that turned out wrong.',
].join(' ')

const addressOfInput = (input: MemoryInput): MemoryAddressInput | null =>
  input.scope === undefined || input.name === undefined
    ? null
    : { scope: input.scope, name: input.name }

const missingRefusal = (action: EMemoryAction): ToolOutcome => ({
  ok: false,
  reason: `action ${action} needs ${REQUIRED[action].join(', ')}`,
})

export class MemoryTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'memory'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  override readonly isConcurrencySafe = (input: MemoryInput): boolean =>
    input.action === EMemoryAction.Read

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const address = addressOfInput(input)
    if (address === null) return missingRefusal(input.action)

    if (input.action === EMemoryAction.Write) {
      const { description: text, type, body } = input
      if (text === undefined || type === undefined || body === undefined)
        return missingRefusal(input.action)
      return await writeMemory({
        ctx: this.ctx,
        input: { ...address, description: text, type, body },
      })
    }

    if (input.action === EMemoryAction.Edit) {
      const { old, new: next, revision } = input
      if (old === undefined || next === undefined || revision === undefined)
        return missingRefusal(input.action)
      return await editMemory({
        ctx: this.ctx,
        input: { ...address, old, new: next, revision },
      })
    }

    if (input.action === EMemoryAction.Delete)
      return await deleteMemory({ ctx: this.ctx, input: address })

    return await readMemory({ ctx: this.ctx, input: address })
  }
}
