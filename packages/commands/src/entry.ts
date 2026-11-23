import { z } from 'zod'

import type { Command } from './registry'
import { EClientAction, ECommandGroup } from './spec'

export enum ECommandEntryKind {
  Command = 'command',
  Skill = 'skill',
}

export enum ECommandSource {
  Builtin = 'builtin',
  Plugin = 'plugin',
  Skill = 'skill',
}

export const commandEntrySchema = z.strictObject({
  name: z.string().min(1),
  summary: z.string(),
  group: z.enum(ECommandGroup),
  argumentHint: z.string().optional(),
  kind: z.enum(ECommandEntryKind),
  source: z.enum(ECommandSource),
  opens: z.enum(EClientAction).optional(),
})

export type CommandEntry = z.infer<typeof commandEntrySchema>

export const entryOf = ({
  command,
  source,
}: {
  command: Command
  source: ECommandSource
}): CommandEntry => ({
  name: command.spec.name,
  summary: command.spec.summary,
  group: command.spec.group,
  argumentHint: command.spec.argumentHint,
  kind: ECommandEntryKind.Command,
  source,
  opens: command.spec.opens,
})

export const skillEntryOf = (skill: {
  name: string
  description: string
  argumentHint: string | null
}): CommandEntry => ({
  name: skill.name,
  summary: skill.description,
  group: ECommandGroup.Workspace,
  argumentHint: skill.argumentHint ?? undefined,
  kind: ECommandEntryKind.Skill,
  source: ECommandSource.Skill,
})
